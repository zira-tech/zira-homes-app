import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export const CreateMaintenanceDialog: React.FC<{ onCreated?: () => void }> = ({ onCreated }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('general');
  const [priority, setPriority] = useState('medium');
  const [leases, setLeases] = useState<any[]>([]);
  const [selectedLeaseId, setSelectedLeaseId] = useState<string | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    if (open) {
      fetchLeases();
    }
  }, [open]);

  const fetchLeases = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase.rpc('get_tenant_leases', { p_user_id: user.id });
      if (error) throw error;
      const leasesData = (data as any)?.leases || [];
      setLeases(leasesData || []);
      if (leasesData && leasesData.length > 0) setSelectedLeaseId(leasesData[0].id);
    } catch (err) {
      console.error('Error fetching tenant leases:', err);
      toast.error('Unable to fetch your leases. Please try again.');
    }
  };

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setCategory('general');
    setPriority('medium');
    setSelectedLeaseId(null);
  };

  const handleSubmit = async () => {
    if (!user) {
      toast.error('You must be signed in to submit a request');
      return;
    }
    if (!selectedLeaseId) {
      toast.error('Please select a lease');
      return;
    }
    if (!title.trim()) {
      toast.error('Please provide a short title for the request');
      return;
    }

    setLoading(true);
    try {
      // Find lease object to extract tenant_id, property_id, unit_id
      const lease = leases.find((l: any) => l.id === selectedLeaseId);
      if (!lease) {
        toast.error('Selected lease not found');
        setLoading(false);
        return;
      }

      const insertPayload: any = {
        title: title.trim(),
        description: description.trim() || null,
        category: category,
        priority: priority,
        status: 'pending',
        submitted_date: new Date().toISOString(),
        tenant_id: lease.tenant_id,
        property_id: lease.property_id ?? lease.unit?.property_id ?? null,
        unit_id: lease.unit_id ?? null
      };

      const { error } = await supabase.from('maintenance_requests').insert(insertPayload);
      if (error) throw error;

      toast.success('Maintenance request submitted');
      setOpen(false);
      resetForm();
      onCreated?.();
    } catch (err: any) {
      console.error('Error creating maintenance request:', err);
      // Friendly error message
      let message = 'Failed to submit maintenance request';
      try {
        if (err?.message) message = err.message;
        else if (typeof err === 'string') message = err;
      } catch (e) {}
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
      <DialogTrigger asChild>
        <Button className="bg-accent hover:bg-accent/90">
          <PlusIcon /> New Request
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Submit Maintenance Request</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Lease <span className="text-destructive ml-1">*</span></label>
            <Select value={selectedLeaseId || ''} onValueChange={(v) => setSelectedLeaseId(v || null)}>
              <SelectTrigger>
                <SelectValue placeholder="Select lease" />
              </SelectTrigger>
              <SelectContent>
                {leases.map((l: any) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.unit_number ? `${l.unit_number} — ${l.property_name}` : l.property_name} ({l.status})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium">Title <span className="text-destructive ml-1">*</span></label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., Leaking faucet in kitchen" />
          </div>

          <div>
            <label className="text-sm font-medium">Description</label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the issue in detail" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-sm font-medium">Category</label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">General</SelectItem>
                  <SelectItem value="plumbing">Plumbing</SelectItem>
                  <SelectItem value="electrical">Electrical</SelectItem>
                  <SelectItem value="hvac">HVAC</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium">Priority</label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={loading}>{loading ? 'Submitting...' : 'Submit Request'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CreateMaintenanceDialog;

function PlusIcon() {
  return (
    <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
