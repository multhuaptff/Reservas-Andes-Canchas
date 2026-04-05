// supabase-client.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// Reemplaza con tus credenciales de Supabase (las mismas del supabase_config.json)
const SUPABASE_URL = 'https://tknyldimsncerdqkwscb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRrbnlsZGltc25jZXJkcWt3c2NiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMzIwMzEsImV4cCI6MjA5MDgwODAzMX0.4_Lfmt3iUfkA0dnFX5yCw2s4amsLjKpLmWYU9UkOy6A';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);