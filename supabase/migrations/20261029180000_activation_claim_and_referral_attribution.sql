-- Keep referral attribution metadata in sync with the immutable referred_by relationship.
CREATE OR REPLACE FUNCTION public.set_my_referrer(ref_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = '28000';
  END IF;

  IF ref_id IS NULL OR ref_id = v_uid THEN
    RETURN;
  END IF;

  UPDATE public.profiles
  SET referred_by = ref_id,
      referral_source = 'referral_link',
      referral_attributed_at = now()
  WHERE id = v_uid
    AND referred_by IS NULL
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = ref_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_my_referrer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_referrer(uuid) TO authenticated;

-- A narrow owner-only RPC exposes activation state without granting clients
-- direct reads of protected subscription/activation columns.
CREATE OR REPLACE FUNCTION public.qs_get_my_activation_status_v2()
RETURNS TABLE (
  is_active boolean,
  is_founder boolean,
  subscription_expires timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = '28000';
  END IF;

  RETURN QUERY
  SELECT p.is_active, p.is_founder, p.subscription_expires
  FROM public.profiles AS p
  WHERE p.id = v_uid;
END;
$function$;

REVOKE ALL ON FUNCTION public.qs_get_my_activation_status_v2() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qs_get_my_activation_status_v2() TO authenticated;

-- The "I've transferred" action is only a claim for review, never activation.
-- Prevent already-active or founder accounts from opening an activation claim.
CREATE OR REPLACE FUNCTION public.qs_submit_payment_claim_v2(
  p_claim_kind text,
  p_client_request_id uuid
)
RETURNS TABLE (
  id uuid,
  claim_kind text,
  amount_ngn integer,
  status text,
  claimed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_kind text := lower(coalesce(p_claim_kind, ''));
  v_row public.payment_claims%rowtype;
  v_is_active boolean;
  v_is_founder boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = '28000';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id is required';
  END IF;
  IF v_kind NOT IN ('activation', 'renewal') THEN
    RAISE EXCEPTION 'Invalid claim kind';
  END IF;

  SELECT p.is_active, p.is_founder
  INTO v_is_active, v_is_founder
  FROM public.profiles AS p
  WHERE p.id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF v_kind = 'activation' AND (coalesce(v_is_active, false) OR coalesce(v_is_founder, false)) THEN
    RAISE EXCEPTION 'This store does not need an activation payment claim';
  END IF;

  SELECT pc.* INTO v_row
  FROM public.payment_claims AS pc
  WHERE pc.user_id = v_uid
    AND pc.client_request_id = p_client_request_id
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT v_row.id, v_row.claim_kind, v_row.amount_ngn, v_row.status, v_row.claimed_at;
    RETURN;
  END IF;

  SELECT pc.* INTO v_row
  FROM public.payment_claims AS pc
  WHERE pc.user_id = v_uid
    AND pc.claim_kind = v_kind
    AND pc.status = 'pending'
  ORDER BY pc.claimed_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT v_row.id, v_row.claim_kind, v_row.amount_ngn, v_row.status, v_row.claimed_at;
    RETURN;
  END IF;

  INSERT INTO public.payment_claims(user_id, claim_kind, amount_ngn, status, client_request_id)
  VALUES (v_uid, v_kind, 1500, 'pending', p_client_request_id)
  RETURNING * INTO v_row;

  RETURN QUERY SELECT v_row.id, v_row.claim_kind, v_row.amount_ngn, v_row.status, v_row.claimed_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.qs_submit_payment_claim_v2(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qs_submit_payment_claim_v2(text, uuid) TO authenticated;
