// =========================================================
// Supabase project configuration
// =========================================================
const SUPABASE_URL = 'https://powdsowqehbinjsohyzg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBvd2Rzb3dxZWhiaW5qc29oeXpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3NTAwODcsImV4cCI6MjEwMzMyNjA4N30.9tZ3g0oilBf6yNlmg0UHXbKexGSIa5OPKj88uS4md80';

// Single shared Supabase client used across the site
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Owner's WhatsApp number for one-time bookings (E.164 format, no + or spaces)
// TODO: replace with the real business WhatsApp number
const OWNER_WHATSAPP_NUMBER = '919629885790';
