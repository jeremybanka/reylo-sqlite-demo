INSERT INTO tasks (id, title, body, status)
VALUES (:id, :title, :body, :status)
RETURNING id, title, body, status, created_at, updated_at
