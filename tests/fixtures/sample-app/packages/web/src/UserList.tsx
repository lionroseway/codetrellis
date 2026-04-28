import { useEffect, useState } from 'react';
import type { User } from '@sample/shared';
import { listUsers, createUser } from './api';
import { validateCreateUser } from '@sample/shared';

export function UserList() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listUsers().then((u) => {
      setUsers(u);
      setLoading(false);
    });
  }, []);

  async function handleAdd(email: string, name: string) {
    const errors = validateCreateUser({ email, name });
    if (errors.length) {
      console.warn('validation failed', errors);
      return;
    }
    const created = await createUser({ email, name });
    setUsers((prev) => [...prev, created]);
  }

  if (loading) return <p>Loading users…</p>;

  return (
    <ul>
      {users.map((u) => (
        <li key={u.id}>
          {u.name} &lt;{u.email}&gt;
        </li>
      ))}
    </ul>
  );
}
