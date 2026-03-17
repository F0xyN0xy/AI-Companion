const { createClient } = require('@supabase/supabase-js');

const headers = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const email = (event.queryStringParameters || {}).email;
  if (!email)
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'email required' }) };

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const { data: user } = await supabase
    .from('users')
    .select('verified')
    .eq('email', email.toLowerCase())
    .maybeSingle();

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ verified: !!user?.verified }),
  };
};
