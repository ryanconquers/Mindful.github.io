DELETE FROM account_tokens
WHERE account_id IN (
  SELECT id FROM accounts WHERE email = 'not-a-real-address@example.test'
);

DELETE FROM account_sessions
WHERE account_id IN (
  SELECT id FROM accounts WHERE email = 'not-a-real-address@example.test'
);

DELETE FROM accounts
WHERE email = 'not-a-real-address@example.test';
