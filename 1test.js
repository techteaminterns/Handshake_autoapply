import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './env.js';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY) // anon key, not service key

// sign in as user 1, note their profile_id
await supabase.auth.signInWithPassword({ email: 'portgasdicordace@gmail.com', password: '123123' })
const { data: own } = await supabase.from('profiles').select('*') // should return their own row

// sign in as user 2
await supabase.auth.signOut()
await supabase.auth.signInWithPassword({ email: 'genshinbiy321@gmail.com', password: '124123' })

// try to read user 1's row directly by id
const { data: leaked, error } = await supabase.from('profiles').select('*').eq('id', '1c75ff41-82cc-456b-8cab-d2df90dcaf08')
console.log(leaked, error) // leaked should be [] (empty array), not user 1's data