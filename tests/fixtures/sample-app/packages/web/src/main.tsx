import { UserList } from './UserList';
import { OrderList } from './OrderList';

export function App() {
  return (
    <main>
      <h1>Sample App</h1>
      <section>
        <h2>Users</h2>
        <UserList />
      </section>
      <section>
        <h2>Orders</h2>
        <OrderList />
      </section>
    </main>
  );
}
