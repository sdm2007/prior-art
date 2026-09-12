import jwt from 'jsonwebtoken';

const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32) {
  throw new Error('JWT_SECRET must be set in .env and be at least 32 characters long.');
}

export function sign(user) {
  return jwt.sign({ id: user.id }, secret, { expiresIn: '7d' });
}

export async function auth(req, res, next) {
  try {
    const token = req.cookies.pa_session;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    const payload = jwt.verify(token, secret);
    req.userId = payload.id;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid session' });
  }
}

export function admin(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'Admin only' });
  next();
}
