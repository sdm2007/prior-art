import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { initDb, query, one, pool, defaults } from './db.js';
import { sign, auth } from './auth.js';
import { callAI, jsonFromAI } from './ai.js';
import { extract, ALLOWED } from './extract.js';
import { saveFile, getDownloadTarget, deleteFile } from './storage.js';
import { enqueueIntake, startWorker } from './queue.js';

const app=express();
app.use(express.json({limit:'1mb'}));
app.use(cookieParser());
const upload=multer({dest:'./tmp-uploads',limits:{fileSize:20*1024*1024},fileFilter:(req,file,cb)=>{const e=path.extname(file.originalname).slice(1).toLowerCase();cb(null,ALLOWED.has(e));}});
const now=()=>Date.now();
const contentTypes=['Notes','PYQ','Assignment','Cheat Sheet','Lab Manual','Syllabus'];
const examTypes=['Mid-Sem','End-Sem','Quiz','University'];

app.get('/api/meta',(req,res)=>res.json({courses:Object.keys(defaults),semesters:[1,2,3,4,5,6,7,8],contentTypes,examTypes,subjectsByCourse:defaults}));
app.post('/api/auth/register',async(req,res)=>{try{const {username,password,course,semester}=req.body;if(!/^[a-zA-Z0-9_.-]{3,40}$/.test(username||''))return res.status(400).json({error:'Username must be 3–40 characters'});if(!password||password.length<8)return res.status(400).json({error:'Password must be at least 8 characters'});if(!defaults[course])return res.status(400).json({error:'Invalid course'});const hash=await bcrypt.hash(password,12);const r=await query('INSERT INTO users(username,password_hash,course,semester,created_at) VALUES(?,?,?,?,?)',[username,hash,course,Number(semester),now()]);res.cookie('pa_session',sign({id:r.insertId}),{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:7*864e5});res.json({ok:true});}catch(e){res.status(400).json({error:String(e.message).includes('Duplicate')?'Username already exists':e.message})}});
app.post('/api/auth/login',async(req,res)=>{const u=await one('SELECT * FROM users WHERE username=?',[req.body.username]);if(!u||!(await bcrypt.compare(req.body.password||'',u.password_hash)))return res.status(401).json({error:'Invalid username or password'});if(u.banned)return res.status(403).json({error:'This account is banned'});res.cookie('pa_session',sign(u),{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:7*864e5});res.json({ok:true})});
app.post('/api/auth/logout',(req,res)=>{res.clearCookie('pa_session');res.json({ok:true})});
app.get('/api/me',auth,async(req,res)=>{const u=await one('SELECT id,username,course,semester,karma,free_downloads_used,is_admin,banned FROM users WHERE id=?',[req.userId]);if(!u||u.banned)return res.status(403).json({error:'Account unavailable'});res.json(u)});

app.get('/api/resources',auth,async(req,res)=>{const u=await one('SELECT course,semester FROM users WHERE id=?',[req.userId]);const p=req.query;let sql=`SELECT r.*,u.username uploader,(SELECT COUNT(*) FROM votes v WHERE v.resource_id=r.id AND v.type='up') up,(SELECT COUNT(*) FROM votes v WHERE v.resource_id=r.id AND v.type='down') down FROM resources r JOIN users u ON u.id=r.uploader_id WHERE r.is_removed=0 AND r.is_flagged=0 AND r.status='published' AND r.course=? AND r.semester=?`;const args=[u.course,u.semester];if(p.subject&&p.subject!=='All'){sql+=' AND r.subject=?';args.push(p.subject)}if(p.contentType&&p.contentType!=='All'){sql+=' AND r.content_type=?';args.push(p.contentType)}if(p.examType&&p.examType!=='All'){sql+=' AND r.exam_type=?';args.push(p.examType)}if(p.q){sql+=' AND MATCH(r.title,r.professor,r.excerpt) AGAINST(? IN NATURAL LANGUAGE MODE)';args.push(p.q)}sql+=' ORDER BY (up-down) DESC,r.downloads DESC,r.created_at DESC LIMIT 500';res.json(await query(sql,args))});
app.get('/api/resources/:id',auth,async(req,res)=>{const r=await one(`SELECT r.*,u.username uploader,(SELECT COUNT(*) FROM votes WHERE resource_id=r.id AND type='up') up,(SELECT COUNT(*) FROM votes WHERE resource_id=r.id AND type='down') down FROM resources r JOIN users u ON u.id=r.uploader_id WHERE r.id=? AND r.status='published'`,[req.params.id]);if(!r)return res.status(404).json({error:'Not found'});res.json(r)});

app.post('/api/resources',auth,upload.single('file'),async(req,res)=>{
  const file=req.file;
  try{
    const u=await one('SELECT * FROM users WHERE id=?',[req.userId]);
    if(!u || u.banned) throw new Error('Account unavailable');
    if(!file) throw new Error('File required');
    const stat=await fs.promises.stat(file.path);
    if(stat.size>20*1024*1024) throw new Error('File is larger than the 20 MB upload limit');
    const bytes=await fs.promises.readFile(file.path);
    const ext=path.extname(file.originalname).slice(1).toLowerCase();
    const sig={pdf:b=>b.subarray(0,5).toString()==='%PDF-',png:b=>b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpg:b=>b.subarray(0,3).equals(Buffer.from([255,216,255])),jpeg:b=>b.subarray(0,3).equals(Buffer.from([255,216,255])),webp:b=>b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP',docx:b=>b.subarray(0,2).toString()==='PK',txt:()=>true};
    if(sig[ext]&&!sig[ext](bytes)) throw new Error('The file contents do not match its extension');
    const hash=crypto.createHash('sha256').update(bytes).digest('hex');
    const exact=await one("SELECT id,title FROM resources WHERE file_hash=? AND status<>'rejected'",[hash]);
    if(exact){await fs.promises.unlink(file.path);return res.status(409).json({error:'This exact file has already been uploaded',duplicate:exact});}
    const id='r_'+crypto.randomBytes(8).toString('hex');
    const objectKey=`resources/${new Date().getFullYear()}/${id}-${crypto.randomBytes(4).toString('hex')}${path.extname(file.originalname).toLowerCase()}`;
    const stored=await saveFile(file.path,objectKey,file.mimetype);
    await query(`INSERT INTO resources(id,uploader_id,course,semester,subject,content_type,exam_type,paper_year,professor,title,excerpt,status,ai_analysis,duplicate_checked,file_name,stored_path,file_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[id,u.id,u.course,u.semester,'','Notes','','','','',null,'processing',null,false,file.originalname,stored.storedPath,hash,now()]);
    const jobId=await enqueueIntake({resourceId:id,userId:u.id});
    res.status(202).json({id,status:'processing',jobId,fileName:file.originalname});
  }catch(e){
    if(file?.path&&fs.existsSync(file.path))await fs.promises.unlink(file.path).catch(()=>{});
    await query('INSERT INTO agent_logs(agent,user_id,input_summary,actions_json,output_summary,status,duration_ms,created_at) VALUES(?,?,?,?,?,?,?,?)',['intake_agent',req.userId,req.body?.title||'',JSON.stringify(['enqueue_pipeline_failed']),String(e.message).slice(0,1000),'error',0,now()]).catch(()=>{});
    res.status(400).json({error:e.message});
  }
});

app.get('/api/jobs/:id',auth,async(req,res)=>{
  const j=await one('SELECT * FROM jobs WHERE id=? AND user_id=?',[req.params.id,req.userId]);
  if(!j)return res.status(404).json({error:'Job not found'});
  const out={id:j.id,status:j.status,attempts:j.attempts,error:j.error||null};
  if(j.status==='completed') { const result=JSON.parse(j.result_json||'{}'); out.resourceId=j.resource_id; out.analysis=result.analysis||{}; out.duplicateCandidates=result.duplicateCandidates||[]; }
  res.json(out);
});

app.post('/api/resources/:id/publish',auth,async(req,res)=>{
  const conn=await pool.getConnection();
  try{
    await conn.beginTransaction();
    const [rows]=await conn.execute('SELECT * FROM resources WHERE id=? AND uploader_id=? FOR UPDATE',[req.params.id,req.userId]);
    const r=rows[0]; if(!r) throw new Error('Draft not found'); if(r.status!=='draft') throw new Error('This resource is no longer publishable');
    const title=String(req.body.title||r.title).trim().slice(0,180), subject=String(req.body.subject||r.subject).trim();
    const [sub]=await conn.execute('SELECT 1 FROM subjects WHERE course=? AND name=? LIMIT 1',[r.course,subject]); if(!sub.length)throw new Error('Invalid subject');
    const ct=String(req.body.contentType||r.content_type); if(!contentTypes.includes(ct))throw new Error('Invalid content type');
    const ex=String(req.body.examType||r.exam_type||''); const year=String(req.body.paperYear||r.paper_year||'');
    if(ex&&!examTypes.includes(ex))throw new Error('Invalid exam type'); if(year&&!/^(19|20)\d{2}$/.test(year))throw new Error('Invalid paper year');
    await conn.execute("UPDATE resources SET title=?,subject=?,content_type=?,exam_type=?,paper_year=?,professor=?,status='published' WHERE id=?",[title,subject,ct,ct==='PYQ'?ex:'',ct==='PYQ'?year:'',String(req.body.professor||r.professor||'').slice(0,120),r.id]);
    await conn.execute('UPDATE users SET karma=karma+10 WHERE id=?',[req.userId]); await conn.execute('INSERT INTO karma_transactions(user_id,amount,reason,resource_id,created_at) VALUES(?,?,?,?,?)',[req.userId,10,'upload',r.id,now()]);
    await conn.commit(); res.json({ok:true,id:r.id,status:'published'});
  }catch(e){await conn.rollback().catch(()=>{});res.status(400).json({error:e.message})}finally{conn.release()}
});
app.post('/api/resources/:id/reject',auth,async(req,res)=>{const r=await one('SELECT * FROM resources WHERE id=? AND uploader_id=?',[req.params.id,req.userId]);if(!r)return res.status(404).json({error:'Draft not found'});if(r.status!=='draft')return res.status(400).json({error:'This resource is no longer a draft'});await query("UPDATE resources SET status='rejected' WHERE id=?",[r.id]);await deleteFile(r.stored_path).catch(()=>{});res.json({ok:true})});

app.post('/api/resources/:id/vote',auth,async(req,res)=>{const {type}=req.body;if(!['up','down'].includes(type))return res.status(400).json({error:'Invalid vote'});await query(`INSERT INTO votes(resource_id,user_id,type,created_at) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE type=VALUES(type),created_at=VALUES(created_at)`,[req.params.id,req.userId,type,now()]);res.json({ok:true})});
app.post('/api/resources/:id/report',auth,async(req,res)=>{try{await query('INSERT INTO reports(resource_id,reporter_id,reason,created_at) VALUES(?,?,?,?)',[req.params.id,req.userId,String(req.body.reason||'No reason').slice(0,500),now()]);const n=(await one("SELECT COUNT(*) n FROM reports WHERE resource_id=? AND status='open'",[req.params.id])).n;if(n>=3)await query('UPDATE resources SET is_flagged=1 WHERE id=?',[req.params.id]);res.json({ok:true,flagged:n>=3})}catch(e){res.status(409).json({error:'You have already reported this resource'})}});

app.post('/api/resources/:id/download',auth,async(req,res)=>{const conn=await pool.getConnection();try{await conn.beginTransaction();const [us]=await conn.execute('SELECT * FROM users WHERE id=? FOR UPDATE',[req.userId]);const u=us[0];const [rs]=await conn.execute('SELECT * FROM resources WHERE id=? FOR UPDATE',[req.params.id]);const r=rs[0];if(!r||r.is_removed||r.is_flagged||r.status!=='published')throw new Error('Resource unavailable');let cost=0;if(u.free_downloads_used<3){await conn.execute('UPDATE users SET free_downloads_used=free_downloads_used+1 WHERE id=?',[u.id])}else{if(u.karma<2)throw new Error('Not enough karma');cost=2;await conn.execute('UPDATE users SET karma=karma-2 WHERE id=?',[u.id]);await conn.execute('INSERT INTO karma_transactions(user_id,amount,reason,resource_id,created_at) VALUES(?,?,?,?,?)',[u.id,-2,'download',r.id,now()])}await conn.execute('UPDATE resources SET downloads=downloads+1 WHERE id=?',[r.id]);await conn.execute('INSERT INTO downloads(resource_id,user_id,cost,created_at) VALUES(?,?,?,?)',[r.id,u.id,cost,now()]);await conn.commit();const target=await getDownloadTarget(r.stored_path,r.file_name);if(target.type==='url')return res.json({url:target.url});return res.download(path.resolve(target.path),r.file_name)}catch(e){await conn.rollback().catch(()=>{});res.status(400).json({error:e.message})}finally{conn.release()}});

app.get('/api/profile',auth,async(req,res)=>{const u=await one('SELECT id,username,course,semester,karma,free_downloads_used,is_admin FROM users WHERE id=?',[req.userId]);const uploads=await query('SELECT id,title,subject,content_type,paper_year,downloads,created_at FROM resources WHERE uploader_id=? AND is_removed=0 ORDER BY created_at DESC',[req.userId]);const karma=await query('SELECT amount,reason,created_at FROM karma_transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 50',[req.userId]);const downloads=await query('SELECT d.cost,d.created_at,r.title,r.id FROM downloads d JOIN resources r ON r.id=d.resource_id WHERE d.user_id=? ORDER BY d.created_at DESC LIMIT 50',[req.userId]);res.json({user:u,uploads,karma,downloads})});
app.post('/api/resources/:id/comments',auth,async(req,res)=>{const body=String(req.body.body||'').trim().slice(0,1000);if(!body)return res.status(400).json({error:'Comment is empty'});const r=await query('INSERT INTO comments(resource_id,user_id,body,created_at) VALUES(?,?,?,?)',[req.params.id,req.userId,body,now()]);res.json(await one('SELECT c.*,u.username FROM comments c JOIN users u ON u.id=c.user_id WHERE c.id=?',[r.insertId]))});
app.get('/api/resources/:id/comments',auth,async(req,res)=>res.json(await query('SELECT c.*,u.username FROM comments c JOIN users u ON u.id=c.user_id WHERE c.resource_id=? ORDER BY c.created_at ASC',[req.params.id])));
app.post('/api/ai/search',auth,async(req,res)=>{try{const u=await one('SELECT course,semester FROM users WHERE id=?',[req.userId]);const rows=await query(`SELECT id,subject,content_type contentType,exam_type examType,paper_year paperYear,professor,title,excerpt FROM resources WHERE course=? AND semester=? AND is_removed=0 AND is_flagged=0 AND status='published' ORDER BY created_at DESC LIMIT 500`,[u.course,u.semester]);const raw=await callAI(`You are a student resource search agent. Return ONLY JSON {"matchedIds":[string],"summary":"short answer"}. Only use IDs supplied.`,`Request: ${req.body.query}\nResources:\n${JSON.stringify(rows)}`);const a=jsonFromAI(raw)||{};const ids=new Set(rows.map(x=>x.id));res.json({matchedIds:(Array.isArray(a.matchedIds)?a.matchedIds:[]).filter(x=>ids.has(x)).slice(0,10),summary:String(a.summary||'').slice(0,500)});}catch(e){res.status(500).json({error:e.message})}});

app.get('/api/admin/reports',auth,async(req,res)=>{const u=await one('SELECT is_admin FROM users WHERE id=?',[req.userId]);if(!u?.is_admin)return res.status(403).json({error:'Admin only'});res.json(await query(`SELECT rp.*,r.title,u.username reporter FROM reports rp JOIN resources r ON r.id=rp.resource_id JOIN users u ON u.id=rp.reporter_id WHERE rp.status='open' ORDER BY rp.created_at ASC`))});
app.post('/api/admin/reports/:id',auth,async(req,res)=>{const u=await one('SELECT is_admin FROM users WHERE id=?',[req.userId]);if(!u?.is_admin)return res.status(403).json({error:'Admin only'});const rep=await one('SELECT * FROM reports WHERE id=?',[req.params.id]);if(!rep)return res.status(404).json({error:'Not found'});await query('UPDATE reports SET status=? WHERE id=?',[req.body.action==='remove'?'resolved':'dismissed',rep.id]);if(req.body.action==='remove')await query('UPDATE resources SET is_removed=1,is_flagged=0 WHERE id=?',[rep.resource_id]);res.json({ok:true})});
app.post('/api/admin/users/:id/ban',auth,async(req,res)=>{const u=await one('SELECT is_admin FROM users WHERE id=?',[req.userId]);if(!u?.is_admin)return res.status(403).json({error:'Admin only'});await query('UPDATE users SET banned=1 WHERE id=?',[req.params.id]);res.json({ok:true})});

const distDir = path.resolve('dist');
app.use(express.static(distDir));
app.get('*', (req,res,next) => {
  if (req.path.startsWith('/api/')) return next();
  return res.sendFile(path.join(distDir, 'index.html'));
});
initDb().then(()=>{ startWorker(); app.listen(process.env.PORT||3000,()=>console.log(`Prior Art API on ${process.env.PORT||3000}`)); }).catch(e=>{console.error('DB init failed',e);process.exit(1)});
