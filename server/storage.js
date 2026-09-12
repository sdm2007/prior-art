import fs from 'fs/promises';
import path from 'path';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const localRoot = path.resolve(process.env.LOCAL_UPLOAD_DIR || './uploads');
const useS3 = Boolean(process.env.S3_BUCKET);
const s3 = useS3 ? new S3Client({
  region: process.env.S3_REGION || 'auto',
  endpoint: process.env.S3_ENDPOINT || undefined,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  credentials: process.env.S3_ACCESS_KEY_ID ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } : undefined
}) : null;

export async function saveFile(localPath, objectKey, contentType) {
  if (!useS3) { await fs.mkdir(localRoot,{recursive:true}); const dest=path.join(localRoot,objectKey); await fs.mkdir(path.dirname(dest),{recursive:true}); await fs.rename(localPath,dest); return { storedPath: dest, remote:false }; }
  const body = await fs.readFile(localPath);
  await s3.send(new PutObjectCommand({Bucket:process.env.S3_BUCKET,Key:objectKey,Body:body,ContentType:contentType||'application/octet-stream'}));
  await fs.unlink(localPath).catch(()=>{});
  return { storedPath: objectKey, remote:true };
}
export async function getDownloadTarget(storedPath, fileName) {
  if (!useS3) return { type:'local', path:storedPath };
  const url=await getSignedUrl(s3,new GetObjectCommand({Bucket:process.env.S3_BUCKET,Key:storedPath,ResponseContentDisposition:`attachment; filename="${String(fileName).replace(/["\\]/g,'')}"`}),{expiresIn:120});
  return { type:'url', url };
}

export async function deleteFile(storedPath) {
  if (!storedPath) return;
  if (!useS3) { await fs.rm(path.resolve(storedPath), { force: true }); return; }
  await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: storedPath }));
}

export async function getLocalFile(storedPath) {
  if (!useS3) return storedPath;
  const tmpDir = path.resolve(process.env.LOCAL_TMP_DIR || './tmp-queue');
  await fs.mkdir(tmpDir,{recursive:true});
  const dest=path.join(tmpDir,`${Date.now()}-${path.basename(storedPath)}`);
  const obj=await s3.send(new GetObjectCommand({Bucket:process.env.S3_BUCKET,Key:storedPath}));
  if (obj.Body?.transformToByteArray) await fs.writeFile(dest,Buffer.from(await obj.Body.transformToByteArray()));
  else await fs.writeFile(dest,Buffer.from(await Readable.fromWeb(obj.Body).toArray().then(a=>Buffer.concat(a))));
  return dest;
}
