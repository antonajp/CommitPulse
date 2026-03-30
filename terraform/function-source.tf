/**
 * Cloud Function source code packaging and upload
 */

# Archive the Cloud Function source code
data "archive_file" "function_source" {
  type        = "zip"
  source_dir  = "${path.module}/../cloud-function"
  output_path = "${path.module}/function-source.zip"
  excludes = [
    "node_modules",
    "dist",
    ".git",
    "*.zip"
  ]
}

# Upload function source to Cloud Storage
resource "google_storage_bucket_object" "function_source_archive" {
  name   = "function-source-${data.archive_file.function_source.output_md5}.zip"
  bucket = google_storage_bucket.function_source.name
  source = data.archive_file.function_source.output_path
}
