import { useQuery } from '@tanstack/react-query';
/**
 * Wraps useQuery for API calls that return { data, error }.
 * Throws when response.error is set so React Query properly sets isError.
 * Unwraps response.data so consumers get clean data directly.
 */
export function useApiQuery(options) {
    const { queryFn, ...rest } = options;
    return useQuery({
        ...rest,
        queryFn: async () => {
            const response = await queryFn();
            if (response.error) {
                throw new Error(response.error);
            }
            return response.data;
        },
    });
}
