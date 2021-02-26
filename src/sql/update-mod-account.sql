UPDATE public.mods
SET name = ${name},
    pass = ${pass},
    email = ${email},
    privileges = ${privileges}::mod_privilege_types[]
WHERE id = ${id}
