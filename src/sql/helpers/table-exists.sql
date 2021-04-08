SELECT COUNT(*) AS exists
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name = $1
