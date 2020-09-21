SELECT *
FROM main.markets
WHERE id = $1
AND account_name <> ''
AND account_password <> ''
