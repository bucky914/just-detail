// =========================================================
// Shared auth helpers — used by signup.html, login.html, dashboard.html
// Requires config.js (supabaseClient) to be loaded first.
// =========================================================

/**
 * Sign up a new client: creates a Supabase auth user, then a row in `clients`.
 * Returns { user, error }
 */
async function signUpClient({ fullName, phone, email, password }) {
  const { data: authData, error: authError } = await supabaseClient.auth.signUp({
    email,
    password,
  });

  if (authError) return { user: null, error: authError };

  const user = authData.user;
  const session = authData.session;

  if (!user) {
    return { user: null, error: null, needsConfirmation: true };
  }

  if (!session) {
    // User was created but no session yet — email confirmation is required
    // by the Supabase project's auth settings. Without a session, auth.uid()
    // is null and the clients insert would be rejected by RLS, so stop here
    // and tell the person to confirm their email first.
    return { user, error: null, needsConfirmation: true };
  }

  // Create the matching clients row (id must equal auth.users.id per RLS policy)
  const { error: clientError } = await supabaseClient
    .from('clients')
    .insert({ id: user.id, full_name: fullName, phone, email });

  if (clientError) return { user, error: clientError };

  return { user, error: null };
}

/**
 * Log in an existing client.
 * Returns { user, error }
 */
async function signInClient({ email, password }) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) return { user: null, error };
  return { user: data.user, error: null };
}

/**
 * Get the current logged-in user (or null). Use to guard dashboard access.
 */
async function getCurrentUser() {
  const { data, error } = await supabaseClient.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

/**
 * Sign out and redirect to login.
 */
async function signOutClient() {
  await supabaseClient.auth.signOut();
  window.location.href = 'login.html';
}

/**
 * Redirect to login.html if no user is signed in. Call at the top of
 * protected pages (dashboard.html). Returns the user if signed in.
 */
async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    window.location.href = 'login.html';
    return null;
  }
  return user;
}