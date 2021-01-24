INSERT INTO public.daemon_intervals (id) VALUES (${id})
ON CONFLICT DO NOTHING;
