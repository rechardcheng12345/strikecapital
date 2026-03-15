import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Users, Plus, Search, Pencil, Trash2, ChevronLeft, ChevronRight,
  Eye, DollarSign, PieChart, UserCheck, KeyRound, Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { adminApi } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import {
  Button, Input, Card, CardBody, CardHeader, Badge, Modal,
  ErrorAlert, Skeleton, EmptyState,
} from '../../components/ui';

function formatCurrency(value) {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return '$' + (num || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateStr) {
  if (!dateStr) return '---';
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

// ─── Fund Overview Cards ─────────────────────────────
function FundOverview() {
  const { data, isLoading, isError } = useApiQuery({
    queryKey: ['admin', 'fund-summary'],
    queryFn: () => adminApi.getFundSummary(),
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="rounded-none">
            <CardBody className="p-4">
              <Skeleton variant="text" className="w-24 h-4 mb-2" />
              <Skeleton variant="text" className="w-32 h-7" />
            </CardBody>
          </Card>
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <Card className="rounded-none mb-6">
        <CardBody className="p-4 text-center text-sm text-gray-500">
          Fund settings not configured.{' '}
          <Link to="/admin/settings" className="text-[#F06010] hover:underline font-medium">
            Configure now
          </Link>
        </CardBody>
      </Card>
    );
  }

  const utilizationPct = data.allocation_pct_used || 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {/* Total Fund Capital */}
      <Card className="rounded-none border-l-4 border-l-[#0D2654]">
        <CardBody className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <Wallet className="w-4 h-4 text-[#0D2654]" />
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total Fund Capital</span>
          </div>
          <p className="text-xl font-bold text-[#0D2654] font-mono">{formatCurrency(data.total_fund_capital)}</p>
        </CardBody>
      </Card>

      {/* Total Allocated */}
      <Card className="rounded-none border-l-4 border-l-[#F06010]">
        <CardBody className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="w-4 h-4 text-[#F06010]" />
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total Allocated</span>
          </div>
          <p className="text-xl font-bold text-[#0D2654] font-mono">{formatCurrency(data.total_allocated)}</p>
        </CardBody>
      </Card>

      {/* Remaining Capacity */}
      <Card className="rounded-none border-l-4 border-l-green-600">
        <CardBody className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <PieChart className="w-4 h-4 text-green-600" />
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Remaining Capacity</span>
          </div>
          <p className="text-xl font-bold text-[#0D2654] font-mono">{formatCurrency(data.remaining_capacity)}</p>
          <div className="mt-2 w-full bg-gray-200 rounded-none h-1.5">
            <div
              className="h-1.5 rounded-none transition-all"
              style={{
                width: `${Math.min(utilizationPct, 100)}%`,
                backgroundColor: utilizationPct > 90 ? '#dc2626' : utilizationPct > 70 ? '#f59e0b' : '#16a34a',
              }}
            />
          </div>
          <p className="text-xs text-gray-400 mt-1">{utilizationPct.toFixed(1)}% allocated</p>
        </CardBody>
      </Card>

      {/* Investor Count */}
      <Card className="rounded-none border-l-4 border-l-purple-600">
        <CardBody className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <UserCheck className="w-4 h-4 text-purple-600" />
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Investors</span>
          </div>
          <p className="text-xl font-bold text-[#0D2654]">{data.investor_count}</p>
        </CardBody>
      </Card>
    </div>
  );
}

// ─── Investor Form Modal ─────────────────────────────
function InvestorFormModal({ isOpen, onClose, investor, fundCapital }) {
  const queryClient = useQueryClient();
  const isEdit = !!investor;

  const [form, setForm] = useState({
    email: investor?.email || '',
    full_name: investor?.full_name || '',
    phone: investor?.phone || '',
    password: '',
    confirm_password: '',
    allocation_amount: investor?.invested_amount ? parseFloat(investor.invested_amount) : 0,
    role: investor?.role || 'investor',
    is_active: investor?.is_active !== undefined ? !!investor.is_active : true,
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const computedPct = fundCapital > 0 && form.allocation_amount > 0
    ? ((form.allocation_amount / fundCapital) * 100).toFixed(2)
    : '0.00';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');

    if (!isEdit) {
      if (form.password.length < 6) {
        setFormError('Password must be at least 6 characters');
        return;
      }
      if (form.password !== form.confirm_password) {
        setFormError('Passwords do not match');
        return;
      }
    }

    setSubmitting(true);
    try {
      if (isEdit) {
        const res = await adminApi.updateInvestor(investor.id, {
          full_name: form.full_name,
          phone: form.phone || undefined,
          invested_amount: form.allocation_amount || 0,
          role: form.role,
          is_active: form.is_active,
        });
        if (res.error) {
          setFormError(res.error);
        } else {
          toast.success('Investor updated');
          queryClient.invalidateQueries({ queryKey: ['admin', 'investors'] });
          queryClient.invalidateQueries({ queryKey: ['admin', 'fund-summary'] });
          onClose();
        }
      } else {
        const res = await adminApi.createInvestor({
          email: form.email,
          password: form.password,
          full_name: form.full_name,
          phone: form.phone || undefined,
          allocation_amount: form.allocation_amount || undefined,
        });
        if (res.error) {
          setFormError(res.error);
        } else {
          toast.success('Investor created');
          queryClient.invalidateQueries({ queryKey: ['admin', 'investors'] });
          queryClient.invalidateQueries({ queryKey: ['admin', 'fund-summary'] });
          onClose();
        }
      }
    } catch {
      setFormError('An unexpected error occurred.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={isEdit ? 'Edit Investor' : 'Add Investor'} size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        {formError && (
          <div className="bg-red-50 border border-red-200 rounded-none p-3 text-sm text-red-700">
            {formError}
          </div>
        )}

        <Input
          label="Email" type="email" required disabled={isEdit}
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          placeholder="investor@example.com" className="rounded-none"
        />

        <Input
          label="Full Name" type="text" required
          value={form.full_name}
          onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
          placeholder="John Smith" className="rounded-none"
        />

        <Input
          label="Phone" type="tel"
          value={form.phone || ''}
          onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          placeholder="+1 (555) 000-0000" className="rounded-none"
        />

        {isEdit && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, role: 'investor' }))}
                className={`px-4 py-2 text-sm font-medium rounded-none border-2 transition-colors ${
                  form.role === 'investor'
                    ? 'border-[#0D2654] bg-[#0D2654] text-white'
                    : 'border-[#0D2654]/20 text-[#0D2654] hover:border-[#0D2654]/40'
                }`}
              >
                Investor
              </button>
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, role: 'admin' }))}
                className={`px-4 py-2 text-sm font-medium rounded-none border-2 transition-colors ${
                  form.role === 'admin'
                    ? 'border-[#0D2654] bg-[#0D2654] text-white'
                    : 'border-[#0D2654]/20 text-[#0D2654] hover:border-[#0D2654]/40'
                }`}
              >
                Admin
              </button>
            </div>
          </div>
        )}

        {!isEdit && (
          <>
            <Input
              label="Password" type="password" required
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="Min 6 characters" className="rounded-none"
            />
            <Input
              label="Confirm Password" type="password" required
              value={form.confirm_password}
              onChange={(e) => setForm((f) => ({ ...f, confirm_password: e.target.value }))}
              placeholder="Re-enter password" className="rounded-none"
            />
          </>
        )}

        {isEdit && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, is_active: true }))}
                className={`px-4 py-2 text-sm font-medium rounded-none border-2 transition-colors ${
                  form.is_active
                    ? 'border-green-600 bg-green-600 text-white'
                    : 'border-gray-300 text-gray-500 hover:border-gray-400'
                }`}
              >
                Active
              </button>
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, is_active: false }))}
                className={`px-4 py-2 text-sm font-medium rounded-none border-2 transition-colors ${
                  !form.is_active
                    ? 'border-red-600 bg-red-600 text-white'
                    : 'border-gray-300 text-gray-500 hover:border-gray-400'
                }`}
              >
                Inactive
              </button>
            </div>
          </div>
        )}

        <div>
          <Input
            label="Invested Amount ($)" type="number" min={0} step="0.01"
            value={form.allocation_amount || ''}
            onChange={(e) => setForm((f) => ({ ...f, allocation_amount: parseFloat(e.target.value) || 0 }))}
            placeholder="100000" className="rounded-none"
          />
          {fundCapital > 0 && (
            <p className="text-xs text-gray-400 mt-1">
              Allocation: <span className="font-medium text-[#0D2654]">{computedPct}%</span> of {formatCurrency(fundCapital)}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose} className="rounded-none">
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={submitting} className="rounded-none">
            {isEdit ? 'Save Changes' : 'Create Investor'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Reset Password Modal ────────────────────────────
function ResetPasswordModal({ isOpen, onClose, investor }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (password.length < 6) {
      setFormError('Password must be at least 6 characters');
      return;
    }
    if (password !== confirmPassword) {
      setFormError('Passwords do not match');
      return;
    }
    setSubmitting(true);
    try {
      const res = await adminApi.resetInvestorPassword(investor.id, password);
      if (res.error) {
        setFormError(res.error);
      } else {
        toast.success(`Password updated for ${investor.full_name}`);
        onClose();
      }
    } catch {
      setFormError('An unexpected error occurred.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Reset Password" size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-gray-600">
          Set a new password for <span className="font-semibold text-[#0D2654]">{investor?.full_name}</span>
        </p>
        {formError && (
          <div className="bg-red-50 border border-red-200 rounded-none p-3 text-sm text-red-700">
            {formError}
          </div>
        )}
        <Input
          label="New Password" type="password" required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Min 6 characters" className="rounded-none"
        />
        <Input
          label="Confirm Password" type="password" required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Re-enter password" className="rounded-none"
        />
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose} className="rounded-none">
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={submitting} className="rounded-none">
            Update Password
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Investor Detail Modal ───────────────────────────
function InvestorDetailModal({ isOpen, onClose, investor }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Investor Details" size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Name</p>
            <p className="text-sm font-semibold text-[#0D2654]">
              {investor.full_name}
              {investor.role === 'admin' && (
                <span className="ml-2 text-xs bg-[#0D2654] text-white px-1.5 py-0.5">Admin</span>
              )}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Email</p>
            <p className="text-sm text-gray-700">{investor.email}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Phone</p>
            <p className="text-sm text-gray-700">{investor.phone || '---'}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Status</p>
            <Badge variant={investor.is_active ? 'green' : 'red'}>
              {investor.is_active ? 'Active' : 'Inactive'}
            </Badge>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Invested Amount</p>
            <p className="text-sm font-semibold text-[#0D2654]">
              {investor.invested_amount ? formatCurrency(investor.invested_amount) : '---'}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Allocation %</p>
            <p className="text-sm font-semibold text-[#F06010]">
              {investor.allocation_pct ? parseFloat(investor.allocation_pct).toFixed(2) + '%' : '---'}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Allocation Since</p>
            <p className="text-sm text-gray-700">{formatDate(investor.allocation_start_date)}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Joined</p>
            <p className="text-sm text-gray-700">{formatDate(investor.created_at)}</p>
          </div>
        </div>
        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={onClose} className="rounded-none">
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Delete Confirm Modal ────────────────────────────
function DeleteConfirmModal({ isOpen, onClose, investor }) {
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const handleDelete = async () => {
    if (!investor) return;
    setDeleting(true);
    setDeleteError('');
    const res = await adminApi.deleteInvestor(investor.id);
    if (res.error) {
      setDeleteError(res.error);
      setDeleting(false);
    } else {
      toast.success(`${investor.full_name} deactivated`);
      queryClient.invalidateQueries({ queryKey: ['admin', 'investors'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'fund-summary'] });
      setDeleting(false);
      onClose();
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Deactivate Investor" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Are you sure you want to deactivate{' '}
          <span className="font-semibold text-[#0D2654]">{investor?.full_name}</span>?
          Their account and allocation will be disabled.
        </p>
        {deleteError && (
          <div className="bg-red-50 border border-red-200 rounded-none p-3 text-sm text-red-700">
            {deleteError}
          </div>
        )}
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose} className="rounded-none">
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete} loading={deleting} className="rounded-none">
            Deactivate
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Table Skeleton ──────────────────────────────────
function TableSkeleton() {
  return (
    <div className="space-y-0">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-6 py-4 border-b border-gray-100">
          <Skeleton variant="text" className="w-1/5 h-5" />
          <Skeleton variant="text" className="w-1/4 h-5" />
          <Skeleton variant="text" className="w-1/6 h-5" />
          <Skeleton variant="text" className="w-16 h-5" />
          <Skeleton variant="text" className="w-1/6 h-5" />
          <Skeleton variant="text" className="w-1/6 h-5" />
          <Skeleton variant="text" className="w-24 h-5" />
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────
export function InvestorManagementPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [debounceTimer, setDebounceTimer] = useState(null);
  const limit = 20;

  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingInvestor, setEditingInvestor] = useState(null);
  const [viewingInvestor, setViewingInvestor] = useState(null);
  const [deletingInvestor, setDeletingInvestor] = useState(null);
  const [resetPasswordInvestor, setResetPasswordInvestor] = useState(null);

  const handleSearchChange = useCallback((value) => {
    setSearch(value);
    if (debounceTimer) clearTimeout(debounceTimer);
    const timer = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(1);
    }, 300);
    setDebounceTimer(timer);
  }, [debounceTimer]);

  const { data, isLoading, isError, error, refetch } = useApiQuery({
    queryKey: ['admin', 'investors', page, limit, debouncedSearch],
    queryFn: () => adminApi.getInvestors(page, limit, debouncedSearch || undefined),
  });

  // Fetch fund capital for allocation % preview in form
  const { data: fundSummary } = useApiQuery({
    queryKey: ['admin', 'fund-summary'],
    queryFn: () => adminApi.getFundSummary(),
  });
  const fundCapital = fundSummary?.total_fund_capital || 0;

  const investors = data?.investors || [];
  const pagination = data?.pagination;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold text-[#0D2654] flex items-center gap-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
          <Users className="w-6 h-6 text-[#F06010]" />
          Investor Management
        </h1>
        <Button variant="primary" onClick={() => setShowAddModal(true)} className="rounded-none gap-2">
          <Plus className="w-4 h-4" />
          Add Investor
        </Button>
      </div>

      {/* Fund Overview */}
      <FundOverview />

      {/* Search */}
      <div className="mb-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border-2 border-[#0D2654]/20 rounded-none bg-white text-sm focus:outline-none focus:border-[#F06010] transition-colors"
          />
        </div>
      </div>

      {/* Error */}
      {isError && (
        <div className="mb-4">
          <ErrorAlert message={error?.message || 'Failed to load investors.'} onRetry={() => refetch()} />
        </div>
      )}

      {/* Table */}
      <Card className="rounded-none border-2 border-[#0D2654]/20 overflow-hidden">
        {isLoading ? (
          <CardBody><TableSkeleton /></CardBody>
        ) : investors.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={Users}
              title="No investors found"
              description={debouncedSearch
                ? 'Try adjusting your search terms.'
                : 'Get started by adding your first investor.'}
              action={!debouncedSearch ? (
                <Button variant="primary" onClick={() => setShowAddModal(true)} className="rounded-none gap-2">
                  <Plus className="w-4 h-4" />
                  Add Investor
                </Button>
              ) : undefined}
            />
          </CardBody>
        ) : (
          <>
            {/* Table Header */}
            <div className="hidden md:grid md:grid-cols-[1fr_1.2fr_0.8fr_0.5fr_0.8fr_0.6fr_0.8fr] gap-2 px-6 py-3 bg-[#0D2654] text-white text-xs font-semibold uppercase tracking-wider">
              <span>Name</span>
              <span>Email</span>
              <span>Phone</span>
              <span>Status</span>
              <span className="text-right">Invested</span>
              <span className="text-right">Alloc %</span>
              <span className="text-right">Actions</span>
            </div>

            {/* Table Rows */}
            {investors.map((inv) => (
              <div
                key={inv.id}
                className="grid grid-cols-1 md:grid-cols-[1fr_1.2fr_0.8fr_0.5fr_0.8fr_0.6fr_0.8fr] gap-2 px-6 py-3 border-b border-gray-100 hover:bg-[#F5F3EF]/50 transition-colors items-center text-sm"
              >
                <span className="font-medium text-[#0D2654]">
                  {inv.full_name}
                  {inv.role === 'admin' && (
                    <span className="ml-2 text-[10px] bg-[#0D2654] text-white px-1.5 py-0.5 uppercase font-bold">
                      Admin
                    </span>
                  )}
                </span>
                <span className="text-gray-600 truncate">{inv.email}</span>
                <span className="text-gray-600">{inv.phone || '---'}</span>
                <span>
                  <Badge variant={inv.is_active ? 'green' : 'red'}>
                    {inv.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </span>
                <span className="text-right font-medium text-[#0D2654] font-mono">
                  {inv.invested_amount ? formatCurrency(inv.invested_amount) : '---'}
                </span>
                <span className="text-right font-medium text-[#F06010] font-mono">
                  {inv.allocation_pct ? parseFloat(inv.allocation_pct).toFixed(2) + '%' : '---'}
                </span>
                <div className="flex items-center justify-end gap-1">
                  <button
                    onClick={() => setViewingInvestor(inv)}
                    className="p-1.5 hover:bg-[#0D2654]/10 rounded-none transition-colors"
                    title="View details"
                  >
                    <Eye className="w-4 h-4 text-[#0D2654]" />
                  </button>
                  <button
                    onClick={() => setEditingInvestor(inv)}
                    className="p-1.5 hover:bg-[#F06010]/10 rounded-none transition-colors"
                    title="Edit investor"
                  >
                    <Pencil className="w-4 h-4 text-[#F06010]" />
                  </button>
                  <button
                    onClick={() => setResetPasswordInvestor(inv)}
                    className="p-1.5 hover:bg-purple-100 rounded-none transition-colors"
                    title="Reset password"
                  >
                    <KeyRound className="w-4 h-4 text-purple-600" />
                  </button>
                  {inv.role !== 'admin' && (
                    <button
                      onClick={() => setDeletingInvestor(inv)}
                      className="p-1.5 hover:bg-red-100 rounded-none transition-colors"
                      title="Deactivate investor"
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </>
        )}
      </Card>

      {/* Pagination */}
      {pagination && pagination.pages > 1 && (
        <div className="flex items-center justify-between mt-4 px-1">
          <p className="text-sm text-gray-500">
            Showing {(pagination.page - 1) * pagination.limit + 1}–
            {Math.min(pagination.page * pagination.limit, pagination.total)} of{' '}
            {pagination.total} investors
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline" size="sm"
              disabled={pagination.page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-none gap-1"
            >
              <ChevronLeft className="w-4 h-4" /> Prev
            </Button>
            <span className="text-sm font-medium text-[#0D2654] px-2">
              {pagination.page} / {pagination.pages}
            </span>
            <Button
              variant="outline" size="sm"
              disabled={pagination.page >= pagination.pages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-none gap-1"
            >
              Next <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Modals */}
      {showAddModal && (
        <InvestorFormModal
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          fundCapital={fundCapital}
        />
      )}

      {editingInvestor && (
        <InvestorFormModal
          isOpen={!!editingInvestor}
          onClose={() => setEditingInvestor(null)}
          investor={editingInvestor}
          fundCapital={fundCapital}
        />
      )}

      {viewingInvestor && (
        <InvestorDetailModal
          isOpen={!!viewingInvestor}
          onClose={() => setViewingInvestor(null)}
          investor={viewingInvestor}
        />
      )}

      {resetPasswordInvestor && (
        <ResetPasswordModal
          isOpen={!!resetPasswordInvestor}
          onClose={() => setResetPasswordInvestor(null)}
          investor={resetPasswordInvestor}
        />
      )}

      <DeleteConfirmModal
        isOpen={!!deletingInvestor}
        onClose={() => setDeletingInvestor(null)}
        investor={deletingInvestor}
      />
    </div>
  );
}
