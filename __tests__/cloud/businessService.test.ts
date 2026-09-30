import { businessService } from '../../src/cloud/businessService';
import { cloudClient } from '../../src/cloud/cloudClient';
import { businessStore } from '../../src/storage/businessStore';
import { userStore } from '../../src/storage/userStore';
import { initDatabase } from '../../src/storage/dbInit';

describe('businessService', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('createBusiness', () => {
    it('validates empty name before requesting', async () => {
      const result = await businessService.createBusiness('   ');
      expect(result.status).toBe('validation_error');
    });

    it('creates business organization and saves local capability session', async () => {
      const mockBusinessData = {
        id: 'biz_new',
        name: 'USTP Startup Hub',
        owner_id: 'user_1',
        timezone: 'Asia/Manila',
        subscription_plan: 'business',
        subscription_status: 'active',
        seat_limit: 5,
        active_seats: 1,
        my_role: 'manager' as const,
        my_status: 'active' as const,
        members: [],
        pending_invitations: [],
        created_at: new Date().toISOString(),
      };

      jest.spyOn(cloudClient, 'request').mockResolvedValueOnce({
        status: 'success',
        data: mockBusinessData,
      });
      jest.spyOn(userStore, 'getActiveSessionToken').mockReturnValue({
        userId: 'user_1',
        accessToken: 'token',
        refreshToken: 'refresh',
      });
      const saveBizSpy = jest.spyOn(businessStore, 'saveBusiness').mockImplementation();
      const saveMemSpy = jest.spyOn(businessStore, 'saveMembership').mockImplementation();
      const saveCapSpy = jest.spyOn(businessStore, 'saveCachedCapabilities').mockImplementation();

      const result = await businessService.createBusiness('USTP Startup Hub', 'Asia/Manila');

      expect(result.status).toBe('success');
      expect(result.data?.id).toBe('biz_new');
      expect(saveBizSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'biz_new', name: 'USTP Startup Hub' })
      );
      expect(saveMemSpy).toHaveBeenCalledWith(
        expect.objectContaining({ businessId: 'biz_new', userId: 'user_1', memberRole: 'manager' })
      );
      expect(saveCapSpy).toHaveBeenCalledWith(
        'user_1',
        'business',
        'business',
        expect.objectContaining({ business_id: 'biz_new', member_role: 'manager' })
      );
    });
  });

  describe('Invitations & Roles', () => {
    it('normalizes email when creating invitations', async () => {
      const reqSpy = jest.spyOn(cloudClient, 'request').mockResolvedValueOnce({
        status: 'success',
        data: {
          id: 'inv_1',
          business_id: 'biz_1',
          business_name: 'Biz',
          invited_by: 'user_1',
          email: 'employee@lafina.app',
          member_role: 'employee',
          status: 'pending',
          expires_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
      });

      const result = await businessService.createInvitation('biz_1', '  Employee@Lafina.App  ', 'employee');
      expect(result.status).toBe('success');
      expect(reqSpy).toHaveBeenCalledWith(
        '/v1/businesses/biz_1/invitations',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ email: 'employee@lafina.app', member_role: 'employee' }),
        }),
        true
      );
    });

    it('accepts invitation and establishes local business lease', async () => {
      const mockSession = {
        business_id: 'biz_joined',
        business_name: 'Joined Corp',
        member_role: 'employee' as const,
        membership_status: 'active' as const,
        lease_expires_at: new Date(Date.now() + 86400000).toISOString(),
        capabilities: ['business_core', 'business_chat'],
      };

      jest.spyOn(cloudClient, 'request').mockResolvedValueOnce({
        status: 'success',
        data: mockSession,
      });
      jest.spyOn(userStore, 'getActiveSessionToken').mockReturnValue({
        userId: 'user_emp',
        accessToken: 'tok',
        refreshToken: 'ref',
      });
      const saveCapSpy = jest.spyOn(businessStore, 'saveCachedCapabilities').mockImplementation();

      const result = await businessService.acceptInvitation('inv_123');
      expect(result.status).toBe('success');
      expect(saveCapSpy).toHaveBeenCalledWith('user_emp', 'student', 'business', mockSession);
    });

    it('updates member status and role', async () => {
      const reqSpy = jest.spyOn(cloudClient, 'request').mockResolvedValue({
        status: 'success',
        data: { detail: 'Updated' },
      });

      await businessService.updateMemberStatus('biz_1', 'user_2', 'suspended');
      expect(reqSpy).toHaveBeenCalledWith(
        '/v1/businesses/biz_1/members/user_2/status',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ status: 'suspended' }),
        }),
        true
      );

      await businessService.updateMemberRole('biz_1', 'user_2', 'manager');
      expect(reqSpy).toHaveBeenCalledWith(
        '/v1/businesses/biz_1/members/user_2/role',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ role: 'manager' }),
        }),
        true
      );
    });
  });
});
