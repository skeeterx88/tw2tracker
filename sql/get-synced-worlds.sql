SELECT * FROM main.worlds
WHERE last_sync IS NOT NULL
ORDER BY market ASC, num ASC
