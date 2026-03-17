const { createClient } = require('@supabase/supabase-js');
const bcrypt           = require('bcryptjs');
const jwt              = require('jsonwebtoken');

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

  const { email, password } = body;
  if (!email || !password)
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email and password are required' }) };

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Fetch user
  const { data: user, error } = await supabase
    .from('users')
    .select('id, email, password_hash, first_name, verified')
    .eq('email', email.toLowerCase())
    .maybeSingle();

  if (error || !user)
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid email or password' }) };

  // Check password
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid)
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid email or password' }) };

  // Check verified
  if (!user.verified)
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({ error: 'unverified', message: 'Please verify your email before signing in.' }),
    };

  // Issue JWT
  const token = jwt.sign(
    { userId: user.id, email: user.email, firstName: user.first_name },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ token, user: { email: user.email, firstName: user.first_name } }),
  };
};
