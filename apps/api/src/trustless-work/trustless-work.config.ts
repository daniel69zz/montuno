import { Inject, Injectable } from '@nestjs/common';
import { ENV, Env } from '../config/env';

@Injectable()
export class TrustlessWorkConfig {
  constructor(@Inject(ENV) private readonly env: Env) {}
  get enabled() {
    const e = this.env;
    return !!(
      e.TRUSTLESS_WORK_API_KEY &&
      e.TRUSTLESS_WORK_PLATFORM_ADDRESS &&
      e.TRUSTLESS_WORK_ADMIN_ADDRESS &&
      e.TRUSTLESS_WORK_PLATFORM_ADDRESS !== e.TRUSTLESS_WORK_ADMIN_ADDRESS
    );
  }
  get baseUrl() {
    return this.env.TRUSTLESS_WORK_BASE_URL.replace(/\/$/, '');
  }
  get apiKey() {
    return this.env.TRUSTLESS_WORK_API_KEY;
  }
  get platform() {
    return this.env.TRUSTLESS_WORK_PLATFORM_ADDRESS;
  }
  get admin() {
    return this.env.TRUSTLESS_WORK_ADMIN_ADDRESS;
  }
}
