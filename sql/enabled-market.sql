SELECT
    *
FROM
    markets
WHERE
    id = $1
AND
    enabled
