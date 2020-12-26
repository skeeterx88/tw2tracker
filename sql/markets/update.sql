UPDATE public.markets
SET
    account_name = $2,
    account_password = $3,
    account_token = $4,
    account_id = $5,
    enabled = $6
WHERE id = $1
