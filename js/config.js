// =========================================================
// Supabase project configuration
// =========================================================
const SUPABASE_URL = 'https://rpaqulrrgzhftmvfjjcg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJwYXF1bHJyZ3poZnRtdmZqamNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3MzA5MTIsImV4cCI6MjEwMzMwNjkxMn0.zKxPFdpK8YfD7-mHDN0vv9h0DdTQC6aPPUGJcFc5w4s';

// Single shared Supabase client used across the site
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Owner's WhatsApp number for one-time bookings (E.164 format, no + or spaces)
// TODO: replace with the real business WhatsApp number
const OWNER_WHATSAPP_NUMBER = '919629885790';