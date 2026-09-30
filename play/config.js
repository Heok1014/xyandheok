// The public API URL is set after the reviewed cloud project is deployed.
export const cloudConfig = {
  apiBase: ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) ? '/api' : 'https://cpqbmcqfxmjknapruzev.supabase.co/functions/v1/couple-world',
  pollInterval: 5000
};
