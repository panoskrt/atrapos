import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { AppShell } from './components/AppShell';
import { ErrorPage, NotFoundPage } from './components/ErrorPage';
import { LoginPage } from './features/auth/LoginPage';
import { EditorPage } from './features/editor/EditorPage';
import { LibraryPage } from './features/library/LibraryPage';
import { AllPoisPage } from './features/pois/AllPoisPage';
import { GpxToolsPage } from './features/gpxTools/GpxToolsPage';
import { ThemeProvider } from './lib/theme';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage />, errorElement: <ErrorPage /> },
  {
    path: '/',
    element: <AppShell />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <LibraryPage />, errorElement: <ErrorPage /> },
      { path: 'routes/:id', element: <EditorPage />, errorElement: <ErrorPage /> },
      { path: 'pois', element: <AllPoisPage />, errorElement: <ErrorPage /> },
      { path: 'gpx-tools', element: <GpxToolsPage />, errorElement: <ErrorPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

export function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
