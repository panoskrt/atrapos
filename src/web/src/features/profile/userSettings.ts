import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { applyUserSettings, type UserSettings } from '../../lib/userPreferences';

export const userSettingsQueryKey = ['user-settings'] as const;

export function useUserSettings(enabled = true) {
  return useQuery({
    queryKey: userSettingsQueryKey,
    queryFn: async () => {
      const settings = await api.get<UserSettings>('/api/settings');
      applyUserSettings(settings);
      return settings;
    },
    staleTime: Infinity,
    enabled,
    retry: false,
  });
}

export function useUpdateUserSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: UserSettings) => api.put<UserSettings>('/api/settings', settings),
    onSuccess: (settings) => {
      applyUserSettings(settings);
      queryClient.setQueryData(userSettingsQueryKey, settings);
    },
  });
}
