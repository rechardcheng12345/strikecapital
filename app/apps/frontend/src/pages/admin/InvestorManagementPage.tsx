import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Users,
  Plus,
  Search,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  Eye,
} from 'lucide-react';
import {
  adminApi,
  type InvestorsResponse,
  type User,
  type CreateInvestorData,
} from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import {
  Button,
  Input,
  Card,
  CardBody,
  Badge,
  Modal,
  ErrorAlert,
  Skeleton,
  EmptyState,
} from '../../components/ui';

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
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
          <Skeleton variant="text" className="w-24 h-5" />
        </div>
      ))}
    </div>
  );
}

// ─── Investor Form Modal ─────────────────────────────
interface InvestorFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  investor?: User | null;
}

function InvestorFormModal({ isOpen, onClose, investor }: InvestorFormModalProps) {
  const queryClient = useQueryClient();
  const isEdit = !!investor;

  const [form, setForm] = useState<CreateInvestorData>({
    email: investor?.email || '',
    full_name: investor?.full_name || '',
    phone: investor?.phone || '',
    allocation_amount: 0,
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [tempPassword, setTempPassword] = useState('');
  const [copied, setCopied] = useState(false);

  // Reset form when investor changes
  useState(() => {
    if (investor) {
      setForm({
        email: investor.email,
        full_name: investor.full_name,
        phone: investor.phone || '',
        allocation_amount: 0,
      });
    } else {
      setForm({ email: '', full_name: '', phone: '', allocation_amount: 0 });
    }
    setFormError('');
    setTempPassword('');
    setCopied(false);
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);

    try {
      if (isEdit && investor) {
        const res = await adminApi.updateInvestor(investor.id, {
          full_name: form.full_name,
          phone: form.phone || undefined,
          allocation_amount: form.allocation_amount || undefined,
        });
        if (res.error) {
          setFormError(res.error);
        } else {
          queryClient.invalidateQueries({ queryKey: ['admin', 'investors'] });
          onClose();
        }
      } else {
        const payload: CreateInvestorData = {
          email: form.email,
          full_name: form.full_name,
          phone: form.phone || undefined,
          allocation_amount: form.allocation_amount || undefined,
        };
        const res = await adminApi.createInvestor(payload);
        if (res.error) {
          setFormError(res.error);
        } else if (res.data) {
          setTempPassword(res.data.temporary_password);
          queryClient.invalidateQueries({ queryKey: ['admin', 'investors'] });
        }
      }
    } catch {
      setFormError('An unexpected error occurred.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(tempPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // If we just created and got the temp password, show it
  if (tempPassword) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Investor Created" size="md">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            The investor account has been created. Share the temporary password below. They will be
            prompted to change it on first login.
          </p>
          <div className="bg-[#F5F3EF] border-2 border-[#0D2654]/20 rounded-none p-4">
            <p className="text-xs font-medium text-gray-500 mb-1 uppercase tracking-wider">
              Temporary Password
            </p>
            <div className="flex items-center gap-2">
              <code className="text-lg font-mono font-bold text-[#0D2654] flex-1 select-all">
                {tempPassword}
              </code>
              <button
                onClick={handleCopy}
                className="p-2 hover:bg-[#0D2654]/10 rounded-none transition-colors"
                title="Copy password"
              >
                {copied ? (
                  <Check className="w-5 h-5 text-green-600" />
                ) : (
                  <Copy className="w-5 h-5 text-[#0D2654]" />
                )}
              </button>
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? 'Edit Investor' : 'Add Investor'}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {formError && (
          <div className="bg-red-50 border border-red-200 rounded-none p-3 text-sm text-red-700">
            {formError}
          </div>
        )}

        <Input
          label="Email"
          type="email"
          required
          disabled={isEdit}
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          placeholder="investor@example.com"
          className="rounded-none"
        />

        <Input
          label="Full Name"
          type="text"
          required
          value={form.full_name}
          onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
          placeholder="John Smith"
          className="rounded-none"
        />

        <Input
          label="Phone"
          type="tel"
          value={form.phone || ''}
          onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          placeholder="+1 (555) 000-0000"
          className="rounded-none"
        />

        <Input
          label="Allocation Amount"
          type="number"
          min={0}
          step="0.01"
          value={form.allocation_amount || ''}
          onChange={(e) =>
            setForm((f) => ({ ...f, allocation_amount: parseFloat(e.target.value) || 0 }))
          }
          placeholder="100000"
          className="rounded-none"
        />

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

// ─── Detail Modal ────────────────────────────────────
interface DetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  investor: User;
}

function InvestorDetailModal({ isOpen, onClose, investor }: DetailModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Investor Details" size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Name</p>
            <p className="text-sm font-semibold text-[#0D2654]">{investor.full_name}</p>
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
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Role</p>
            <p className="text-sm text-gray-700 capitalize">{investor.role}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Created</p>
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

// ─── Delete Confirmation Modal ───────────────────────
interface DeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  investor: User | null;
}

function DeleteConfirmModal({ isOpen, onClose, investor }: DeleteModalProps) {
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
      queryClient.invalidateQueries({ queryKey: ['admin', 'investors'] });
      setDeleting(false);
      onClose();
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Delete Investor" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Are you sure you want to delete{' '}
          <span className="font-semibold text-[#0D2654]">{investor?.full_name}</span>? This action
          cannot be undone.
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
          <Button
            variant="danger"
            onClick={handleDelete}
            loading={deleting}
            className="rounded-none"
          >
            Delete
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Main Page ───────────────────────────────────────
export function InvestorManagementPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [debounceTimer, setDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const limit = 20;

  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingInvestor, setEditingInvestor] = useState<User | null>(null);
  const [viewingInvestor, setViewingInvestor] = useState<User | null>(null);
  const [deletingInvestor, setDeletingInvestor] = useState<User | null>(null);

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearch(value);
      if (debounceTimer) clearTimeout(debounceTimer);
      const timer = setTimeout(() => {
        setDebouncedSearch(value);
        setPage(1);
      }, 300);
      setDebounceTimer(timer);
    },
    [debounceTimer]
  );

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useApiQuery<InvestorsResponse>({
    queryKey: ['admin', 'investors', page, limit, debouncedSearch],
    queryFn: () => adminApi.getInvestors(page, limit, debouncedSearch || undefined),
  });

  const investors = data?.investors || [];
  const pagination = data?.pagination;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <h1
          className="text-2xl font-bold text-[#0D2654] flex items-center gap-2"
          style={{ fontFamily: 'Space Grotesk, sans-serif' }}
        >
          <Users className="w-6 h-6 text-[#F06010]" />
          Investor Management
        </h1>
        <Button
          variant="primary"
          onClick={() => setShowAddModal(true)}
          className="rounded-none gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Investor
        </Button>
      </div>

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
          <ErrorAlert
            message={error?.message || 'Failed to load investors.'}
            onRetry={() => refetch()}
          />
        </div>
      )}

      {/* Table */}
      <Card className="rounded-none border-2 border-[#0D2654]/20 overflow-hidden">
        {isLoading ? (
          <CardBody>
            <TableSkeleton />
          </CardBody>
        ) : investors.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={Users}
              title="No investors found"
              description={
                debouncedSearch
                  ? 'Try adjusting your search terms.'
                  : 'Get started by adding your first investor.'
              }
              action={
                !debouncedSearch ? (
                  <Button
                    variant="primary"
                    onClick={() => setShowAddModal(true)}
                    className="rounded-none gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    Add Investor
                  </Button>
                ) : undefined
              }
            />
          </CardBody>
        ) : (
          <>
            {/* Table Header */}
            <div className="hidden md:grid md:grid-cols-[1fr_1.2fr_0.8fr_0.6fr_0.8fr_0.8fr_0.6fr] gap-2 px-6 py-3 bg-[#0D2654] text-white text-xs font-semibold uppercase tracking-wider">
              <span>Name</span>
              <span>Email</span>
              <span>Phone</span>
              <span>Status</span>
              <span>Created</span>
              <span className="text-right">Allocation</span>
              <span className="text-right">Actions</span>
            </div>

            {/* Table Rows */}
            {investors.map((inv) => (
              <div
                key={inv.id}
                className="grid grid-cols-1 md:grid-cols-[1fr_1.2fr_0.8fr_0.6fr_0.8fr_0.8fr_0.6fr] gap-2 px-6 py-3 border-b border-gray-100 hover:bg-[#F5F3EF]/50 transition-colors items-center text-sm"
              >
                <span className="font-medium text-[#0D2654]">{inv.full_name}</span>
                <span className="text-gray-600 truncate">{inv.email}</span>
                <span className="text-gray-600">{inv.phone || '---'}</span>
                <span>
                  <Badge variant={inv.is_active ? 'green' : 'red'}>
                    {inv.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </span>
                <span className="text-gray-500 text-xs">{formatDate(inv.created_at)}</span>
                <span className="text-right font-medium text-[#0D2654]">---</span>
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
                    onClick={() => setDeletingInvestor(inv)}
                    className="p-1.5 hover:bg-red-100 rounded-none transition-colors"
                    title="Delete investor"
                  >
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </button>
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
            Showing {(pagination.page - 1) * pagination.limit + 1}--
            {Math.min(pagination.page * pagination.limit, pagination.total)} of{' '}
            {pagination.total} investors
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-none gap-1"
            >
              <ChevronLeft className="w-4 h-4" />
              Prev
            </Button>
            <span className="text-sm font-medium text-[#0D2654] px-2">
              {pagination.page} / {pagination.pages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.pages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-none gap-1"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Modals */}
      {showAddModal && (
        <InvestorFormModal
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {editingInvestor && (
        <InvestorFormModal
          isOpen={!!editingInvestor}
          onClose={() => setEditingInvestor(null)}
          investor={editingInvestor}
        />
      )}

      {viewingInvestor && (
        <InvestorDetailModal
          isOpen={!!viewingInvestor}
          onClose={() => setViewingInvestor(null)}
          investor={viewingInvestor}
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
