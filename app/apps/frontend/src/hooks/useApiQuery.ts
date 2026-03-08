import { useQuery, type UseQueryOptions, type QueryKey } from '@tanstack/react-query';

interface ApiResponse<T> {
  data?: T;
  error?: string;
}

/**
 * Wraps useQuery for API calls that return { data, error }.
 * Throws when response.error is set so React Query properly sets isError.
 * Unwraps response.data so consumers get clean data directly.
 */
export function useApiQuery<T>(
  options: Omit<UseQueryOptions<T, Error, T, QueryKey>, 'queryFn'> & {
    queryFn: () => Promise<ApiResponse<T>>;
  }
) {
  const { queryFn, ...rest } = options;

  return useQuery<T, Error, T, QueryKey>({
    ...rest,
    queryFn: async () => {
      const response = await queryFn();
      if (response.error) {
        throw new Error(response.error);
      }
      return response.data as T;
    },
  });
}
