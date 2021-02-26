UPDATE public.mods
SET name = ${name},
    pass = ${pass},
    privileges = ${privileges}::mod_privilege_types[]
WHERE id = ${id}
