-- Supabase-only setup. A plain PostgreSQL test database has no storage schema.
BEGIN;
DO $$ BEGIN
 IF to_regclass('storage.objects') IS NOT NULL THEN
  INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  VALUES('finagent-private','finagent-private',false,5242880,ARRAY['image/png','image/jpeg','application/pdf','text/plain'])
  ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=5242880,allowed_mime_types=excluded.allowed_mime_types;
  EXECUTE 'CREATE POLICY finagent_private_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id=''finagent-private'' AND (storage.foldername(name))[1]=(select auth.uid())::text)';
  EXECUTE 'CREATE POLICY finagent_private_select ON storage.objects FOR SELECT TO authenticated USING(bucket_id=''finagent-private'' AND (storage.foldername(name))[1]=(select auth.uid())::text)';
  EXECUTE 'CREATE POLICY finagent_private_delete ON storage.objects FOR DELETE TO authenticated USING(bucket_id=''finagent-private'' AND (storage.foldername(name))[1]=(select auth.uid())::text)';
 END IF;
END $$;
COMMIT;
