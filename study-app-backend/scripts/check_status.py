"""Check ingestion progress for a document.

Usage:
    uv run python check_status.py <document_id>
"""
import sys

from app.clients import supabase

if len(sys.argv) != 2:
    print("usage: python check_status.py <document_id>", file=sys.stderr)
    sys.exit(1)

doc_id = sys.argv[1]

doc = supabase.table("documents").select("*").eq("id", doc_id).single().execute().data
chunks = supabase.table("chunks").select("id", count="exact").eq("document_id", doc_id).execute()

print(f"status:       {doc['status']}")
print(f"progress:     {doc.get('progress') or '—'}")
print(f"source_type:  {doc['source_type']}")
print(f"chunks:       {chunks.count}")
print(f"outline?      {'yes (' + str(len(doc['outline'])) + ' chars)' if doc.get('outline') else 'no'}")
if doc.get("outline"):
    print("\n--- outline preview ---")
    print(doc["outline"][:1000])
