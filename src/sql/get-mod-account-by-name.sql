SELECT * FROM public.mods
WHERE LOWER(name) = LOWER(${name})
