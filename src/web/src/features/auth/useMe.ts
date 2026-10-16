import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../../lib/api';
import { withSuunto } from '../../lib/suuntoActivity';

export interface Me {
  username: string;
  suuntoMode: 'Mock' | 'Live';
  suuntoConnected: boolean;
  googleAccount: boolean;
}

export const meQueryKey = ['me'] as const;

/** The signed-in user, or null when there is no session. */
export function useMe() {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: async (): Promise<Me | null> => {
      try {
        return await api.get<Me>('/api/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    // Disconnect revokes Suunto access; logout ends the app session.
    mutationFn: async (mode: 'logout' | 'disconnect') => {
      if (mode === 'disconnect')
        return withSuunto('Disconnecting from Suunto…', () => api.post<{ sessionPreserved: boolean }>('/auth/disconnect'));
      await api.post<void>('/auth/logout');
      return { sessionPreserved: false };
    },
    onSuccess: (result) => {
      if (result.sessionPreserved) {
        qc.setQueryData<Me | null>(meQueryKey, (current) => (current ? { ...current, suuntoConnected: false } : current));
        void qc.invalidateQueries({ queryKey: meQueryKey });
      } else {
        qc.setQueryData(meQueryKey, null);
        qc.removeQueries({ predicate: (q) => q.queryKey[0] !== meQueryKey[0] });
      }
    },
  });
}
