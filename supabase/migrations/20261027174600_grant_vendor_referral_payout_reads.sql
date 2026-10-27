-- The vendor referral dashboard reads these tables directly through Supabase REST.
-- RLS policies remain responsible for restricting each vendor to their own payout rows.
-- Table privileges and RLS are separate: authenticated needs SELECT for the policies to apply.
GRANT SELECT ON TABLE public.referral_payout_items TO authenticated;
GRANT SELECT ON TABLE public.referral_payout_batches TO authenticated;
