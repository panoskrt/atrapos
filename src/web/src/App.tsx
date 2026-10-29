import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider, type RouteObject } from 'react-router';
import { AppShell } from './components/AppShell';
import { ErrorPage, NotFoundPage } from './components/ErrorPage';
import { LoginPage } from './features/auth/LoginPage';
import { CookiesPage } from './features/legal/CookiesPage';
import { PrivacyPage } from './features/legal/PrivacyPage';
import { EditorPage } from './features/editor/EditorPage';
import { LibraryPage } from './features/library/LibraryPage';
import { AllPoisPage } from './features/pois/AllPoisPage';
import { GpxToolsPage } from './features/gpxTools/GpxToolsPage';
import { ProfilePage } from './features/profile/ProfilePage';
import { ThemeProvider } from './lib/theme';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage />, errorElement: <ErrorPage /> },
  // Outside the signed-in area, so anyone can read them.
  { path: '/privacy', element: <PrivacyPage />, errorElement: <ErrorPage /> },
  { path: '/cookies', element: <CookiesPage />, errorElement: <ErrorPage /> },
  {
    path: '/',
    element: <AppShell />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <LibraryPage />, errorElement: <ErrorPage /> },
      { path: 'routes/:id', element: <EditorPage />, errorElement: <ErrorPage /> },
      { path: 'pois', element: <AllPoisPage />, errorElement: <ErrorPage /> },
      { path: 'gpx-tools', element: <GpxToolsPage />, errorElement: <ErrorPage /> },
      { path: 'profile', element: <ProfilePage />, errorElement: <ErrorPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

const router = createBrowserRouter(routes);

export function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
