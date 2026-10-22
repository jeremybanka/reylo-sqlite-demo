UPDATE tasks SET title = :title, body = :body, status = :status,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = :id
RETURNING id, title, body, status, created_at, updated_at
