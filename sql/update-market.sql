UPDATE
    markets
SET
    account_name = $2,
    account_token = $3,
    account_id = $4,
    enabled = $5
WHERE
    id = $1
