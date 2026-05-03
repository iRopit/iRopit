/**
 * Default API Instance
 *
 * Pre-configured API service instance
 */

import { config, TIMEOUTS } from '../../config/env';
import { ApiService } from './apiService';

export const apiService = new ApiService({
  baseUrl: config.apiBaseUrl,
  defaultHeaders: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-App-Version': '1.0.4',
    'X-Platform': 'mobile',
  },
  timeout: TIMEOUTS.API_REQUEST,
});

export default apiService;
