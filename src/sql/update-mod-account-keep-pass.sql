UPDATE public.mods
SET name = ${name},
    email = ${email},
    privileges = ${privileges}::mod_privilege_types[]
WHERE id = ${id}
