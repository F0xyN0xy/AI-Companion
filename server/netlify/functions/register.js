const { createClient } = require('@supabase/supabase-js');
const bcrypt           = require('bcryptjs');
const nodemailer       = require('nodemailer');
const crypto           = require('crypto');

const headers = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { email, password, firstName } = body;

  if (!email || !password || !firstName)
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'email, password and firstName are required' }) };

  if (password.length < 8)
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Password must be at least 8 characters' }) };

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Check duplicate
  const { data: existing } = await supabase
    .from('users')
    .select('email')
    .eq('email', email.toLowerCase())
    .maybeSingle();

  if (existing)
    return { statusCode: 409, headers, body: JSON.stringify({ error: 'An account with that email already exists.' }) };

  // Hash password
  const passwordHash = await bcrypt.hash(password, 12);

  // Generate email verification token (expires in 24h)
  const verifyToken   = crypto.randomBytes(32).toString('hex');
  const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // Insert user
  const { data: user, error: insertError } = await supabase
    .from('users')
    .insert({
      email:          email.toLowerCase(),
      password_hash:  passwordHash,
      first_name:     firstName,
      verified:       false,
      verify_token:   verifyToken,
      verify_expires: verifyExpires,
    })
    .select('id')
    .single();

  if (insertError)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to create account.' }) };

  // Send verification email
  const baseUrl     = process.env.APP_URL || 'https://ai-companion-nova.netlify.app';
  const confirmLink = `${baseUrl}/.netlify/functions/verify-email?token=${verifyToken}`;

  const transporter = nodemailer.createTransport({
    host:   'smtp.gmail.com',
    port:   587,
    secure: false,
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  try {
    await transporter.sendMail({
      from:    `"AI Companion" <${process.env.GMAIL_USER}>`,
      to:      email,
      subject: 'Confirm your email',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
          <h2 style="margin-bottom:8px">Hey ${firstName} 👋</h2>
          <p style="color:#555;line-height:1.6">
            Thanks for signing up! Click the button below to confirm your email address.
            This link expires in 24 hours.
          </p>
          <a href="${confirmLink}"
             style="display:inline-block;margin-top:24px;padding:12px 24px;
                    background:#1a1a2e;color:#fff;border-radius:8px;
                    text-decoration:none;font-weight:600">
            Confirm my email
          </a>
          <p style="margin-top:24px;font-size:12px;color:#999">
            Or copy this link: ${confirmLink}
          </p>
        </div>
      `,
    });
  } catch (emailError) {
    console.error('Email send failed:', emailError.message);
    // Don't fail registration — user can request resend
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ message: 'Account created! Check your email to verify.' }),
  };
};
