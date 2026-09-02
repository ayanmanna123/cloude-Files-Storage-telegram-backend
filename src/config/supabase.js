const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn('Missing Supabase URL or Key. Please check your .env file.');
}

// Initialize the Supabase client
const supabase = createClient(supabaseUrl || '', supabaseKey || '');

module.exports = supabase;
