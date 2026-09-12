import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { query, one, pool } from './db.js';
import { extract } from './extract.js';
import { callAI, jsonFromAI } from './ai.js';
import { getLocalFile, deleteFile } from './storage.js';

const contentTypes=['Notes','PYQ','Assignment','Cheat Sheet','Lab Manual','Syllabus'];
const examTypes=['Mid-Sem','End-Sem','Quiz','University'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const now=()=>Date.now();

export async function enqueueIntake({resourceId,userId}) {
  const id='job_'+crypto.randomBytes(10).toString('hex');
  await query(`INSERT INTO jobs(id,type,resource_id,user_id,status,attempts,max_attempts,available_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,[id,'intake',resourceId,userId,'queued',0,3,now(),now(),now()]);
  return id;
}

async function claimJob() {
  const conn=await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows]=await conn.execute(`SELECT * FROM jobs WHERE status='queued' AND available_at<=? ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,[now()]);
    if(!rows.length){await conn.rollback();return null;}
    const j=rows[0];
    await conn.execute(`UPDATE jobs SET status='processing',attempts=attempts+1,locked_at=?,updated_at=? WHERE id=?`,[now(),now(),j.id]);
    await conn.commit();
    return j;
  } catch(e){await conn.rollback();throw e} finally{conn.release()}
}

async function processIntake(job){
  const started=now();
  const r=await one(`SELECT r.*,u.course AS uploader_course,u.semester AS uploader_semester FROM resources r JOIN users u ON u.id=r.uploader_id WHERE r.id=?`,[job.resource_id]);
  if(!r) throw new Error('Resource no longer exists');
  const temp=await getLocalFile(r.stored_path);
  try {
    const file={path:temp,originalname:r.file_name,mimetype:'application/octet-stream'};
    const text=await extract(file);
    if(!text.trim()) throw new Error('No readable text could be extracted. Upload a text-based document or a clearer scan.');
    const subjects=(await query('SELECT name FROM subjects WHERE course=?',[r.course])).map(x=>x.name);
    const raw=await callAI(`Classify an academic upload. Return ONLY JSON: {"subject":"provided subject or UNSURE","subjectConfidence":0-1,"contentType":"Notes|PYQ|Assignment|Cheat Sheet|Lab Manual|Syllabus","examType":"Mid-Sem|End-Sem|Quiz|University|","paperYear":"YYYY or ","professor":"","suggestedTitle":"","reasoning":""}. Never invent a subject.`,`Course: ${r.course}\nValid subjects: ${subjects.join(', ')}\nFilename: ${r.file_name}\nExtracted text:\n${text.slice(0,6000)}`);
    const a=jsonFromAI(raw)||{};
    const subject=subjects.includes(a.subject)?a.subject:'';
    const ct=contentTypes.includes(a.contentType)?a.contentType:'Notes';
    const ex=ct==='PYQ'&&examTypes.includes(a.examType)?a.examType:'';
    const year=/^(19|20)\d{2}$/.test(String(a.paperYear||''))?String(a.paperYear):'';
    const title=String(a.suggestedTitle||r.file_name).trim().slice(0,180);
    let duplicates=[];
    if(subject){duplicates=await query(`SELECT id,title,subject,content_type contentType,exam_type examType,paper_year paperYear,downloads,MATCH(title,professor,excerpt) AGAINST(? IN NATURAL LANGUAGE MODE) relevance FROM resources WHERE id<>? AND course=? AND semester=? AND subject=? AND content_type=? AND status='published' AND is_removed=0 ORDER BY relevance DESC,created_at DESC LIMIT 5`,[title,r.id,r.course,r.semester,subject,ct]);}
    await query(`UPDATE resources SET subject=?,content_type=?,exam_type=?,paper_year=?,professor=?,title=?,excerpt=?,status='draft',ai_analysis=?,duplicate_checked=1 WHERE id=?`,[subject,ct,ex,year,String(a.professor||'').slice(0,120),title,text.slice(0,1500),JSON.stringify(a),r.id]);
    await query('INSERT INTO agent_logs(agent,user_id,input_summary,actions_json,output_summary,status,duration_ms,created_at) VALUES(?,?,?,?,?,?,?,?)',['intake_agent',job.user_id,r.file_name,JSON.stringify(['extract_text','classify','subject_match','metadata','similarity_candidates']),JSON.stringify({analysis:a,duplicateCandidates:duplicates.map(d=>d.id)}).slice(0,4000),'success',now()-started,now()]);
    await query(`UPDATE jobs SET status='completed',result_json=?,updated_at=?,finished_at=?,error=NULL WHERE id=?`,[JSON.stringify({analysis:a,duplicateCandidates:duplicates}),now(),now(),job.id]);
  } finally { await fs.rm(temp,{force:true}).catch(()=>{}); }
}

async function failJob(job,e){
  const msg=String(e?.message||e).slice(0,1000);
  if(job.attempts < job.max_attempts){
    const delay=Math.min(60000,5000*Math.pow(2,job.attempts-1));
    await query(`UPDATE jobs SET status='queued',available_at=?,error=?,updated_at=?,locked_at=NULL WHERE id=?`,[now()+delay,msg,now(),job.id]);
  } else {
    await query(`UPDATE jobs SET status='failed',error=?,updated_at=?,finished_at=? WHERE id=?`,[msg,now(),now(),job.id]);
    await query(`UPDATE resources SET status='rejected' WHERE id=? AND status='processing'`,[job.resource_id]);
    await query('INSERT INTO agent_logs(agent,user_id,input_summary,actions_json,output_summary,status,duration_ms,created_at) VALUES(?,?,?,?,?,?,?,?)',['intake_agent',job.user_id,job.resource_id,JSON.stringify(['queue_failed']),msg,'error',0,now()]).catch(()=>{});
  }
}

export async function startWorker({pollMs=1000}={}){
  let running=true;
  process.once('SIGTERM',()=>{running=false}); process.once('SIGINT',()=>{running=false});
  while(running){
    try { const job=await claimJob(); if(!job){await sleep(pollMs);continue;} try{if(job.type==='intake')await processIntake(job);}catch(e){await failJob(job,e);} }
    catch(e){console.error('queue worker error',e);await sleep(2000);}
  }
}
