import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getOne, run } from '../db/database.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();

// JWT_SECRET validated in middleware/auth.ts at startup — read directly here
const JWT_SECRET = process.env.JWT_SECRET!;

// Google OAuth — all optional; Google login is disabled if CLIENT_ID is absent
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_CALLBACK_URL  = process.env.GOOGLE_CALLBACK_URL  || '';
const FRONTEND_URL         = process.env.FRONTEND_URL         || '';

// ── Email/password login ───────────────────────────────────────────────────
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: 'Email y contraseña son requeridos' });
    return;
  }

  const user = await getOne('SELECT * FROM usuarios WHERE email = $1', [email]);

  if (!user) {
    res.status(401).json({ error: 'Credenciales inválidas' });
    return;
  }

  if (!user.password_hash) {
    res.status(401).json({ error: 'Esta cuenta fue creada con Google. Usa "Iniciar sesión con Google".' });
    return;
  }

  const validPassword = bcrypt.compareSync(password, user.password_hash);
  if (!validPassword) {
    res.status(401).json({ error: 'Credenciales inválidas' });
    return;
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, rol: user.rol, nombre: user.nombre },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  res.json({
    token,
    user: {
      id: user.id,
      nombre: user.nombre,
      email: user.email,
      rol: user.rol,
    },
  });
});

// ── Current user ───────────────────────────────────────────────────────────
router.get('/me', authMiddleware, (req: AuthRequest, res: Response) => {
  res.json({ user: req.user });
});

// ── Register ───────────────────────────────────────────────────────────────
router.post('/register', async (req: Request, res: Response) => {
  const { nombre, email, password, rol } = req.body;

  if (!nombre || !email || !password) {
    res.status(400).json({ error: 'Nombre, email y contraseña son requeridos' });
    return;
  }

  const existing = await getOne('SELECT id FROM usuarios WHERE email = $1', [email]);
  if (existing) {
    res.status(409).json({ error: 'El email ya está registrado' });
    return;
  }

  const hash = bcrypt.hashSync(password, 10);
  const result = await getOne(
    'INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES ($1, $2, $3, $4) RETURNING id',
    [nombre, email, hash, rol || 'viewer']
  );

  res.status(201).json({
    id: result.id,
    nombre,
    email,
    rol: rol || 'viewer',
  });
});

// ── Google OAuth ───────────────────────────────────────────────────────────

// Step 1: redirect browser to Google consent page
router.get('/google', (req: Request, res: Response) => {
  if (!GOOGLE_CLIENT_ID) {
    res.status(503).json({ error: 'Google OAuth no está configurado en el servidor' });
    return;
  }

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_CALLBACK_URL,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// Step 2: Google redirects here with ?code=...
router.get('/google/callback', async (req: Request, res: Response) => {
  const { code, error } = req.query;

  if (error || !code) {
    res.redirect(`${FRONTEND_URL}/login?error=google_cancelled`);
    return;
  }

  try {
    // Exchange authorization code for access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: code as string,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_CALLBACK_URL,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenRes.json() as Record<string, any>;

    if (!tokenData.access_token) {
      throw new Error('No se recibió access_token de Google');
    }

    // Get Google user info
    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const googleUser = await userInfoRes.json() as Record<string, any>;
    const { sub: googleId, email, name } = googleUser;

    if (!email) {
      throw new Error('Google no devolvió un email');
    }

    // Find or create local user
    let user = await getOne('SELECT * FROM usuarios WHERE email = $1', [email]);

    if (!user) {
      // First Google login — create account with viewer role
      user = await getOne(
        `INSERT INTO usuarios (nombre, email, password_hash, rol, google_id)
         VALUES ($1, $2, NULL, 'viewer', $3)
         RETURNING id, nombre, email, rol`,
        [name || email, email, googleId]
      );
    } else if (!user.google_id) {
      // Existing email/password account — link Google ID
      await run('UPDATE usuarios SET google_id = $1 WHERE id = $2', [googleId, user.id]);
    }

    const appToken = jwt.sign(
      { id: user.id, email: user.email, rol: user.rol, nombre: user.nombre },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.redirect(`${FRONTEND_URL}/auth/callback?token=${appToken}`);
  } catch (err) {
    console.error('[Google OAuth] error:', err);
    res.redirect(`${FRONTEND_URL}/login?error=google_failed`);
  }
});

export default router;
