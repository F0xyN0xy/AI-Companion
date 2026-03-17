const { createClient } = require('@supabase/supabase-js');

const headers = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json',
};

exports.handler = async (event) => {
  const token = (event.queryStringParameters || {}).token;

  if (!token)
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Token required' }) };

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Find user with this token
  const { data: user, error } = await supabase
    .from('users')
    .select('id, verified, verify_expires')
    .eq('verify_token', token)
    .maybeSingle();

  if (error || !user)
    return redirect('invalid');

  if (user.verified)
    return redirect('already');

  if (new Date(user.verify_expires) < new Date())
    return redirect('expired');

  // Mark as verified, clear token
  await supabase
    .from('users')
    .update({ verified: true, verify_token: null, verify_expires: null })
    .eq('id', user.id);

  return redirect('success');
};

function redirect(status) {
  const baseUrl = process.env.APP_URL || 'https://ai-companion-nova.netlify.app';
  return {
    statusCode: 302,
    headers: { Location: `${baseUrl}/verified.html?status=${status}` },
    body: '',
  };
}
