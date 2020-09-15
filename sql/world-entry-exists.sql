SELECT EXISTS(
    SELECT 1
    FROM public.worlds
    WHERE market = $1
    AND num = $2
)
