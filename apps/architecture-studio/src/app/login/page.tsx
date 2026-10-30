import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// Reached only by a signed-in person: in Entra mode the layout shows the sign-in screen to everyone else, in front of this page.
export default function LoginPage() {
  redirect('/');
}
