import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface MpesaTransaction {
  result_code: number | null;
  result_desc: string | null;
  status: string | null;
  mpesa_receipt_number: string | null;
}

interface UseRealtimeMpesaStatusResult {
  transaction: MpesaTransaction | null;
  isListening: boolean;
  error: string | null;
}

export function useRealtimeMpesaStatus(
  checkoutRequestId: string | null
): UseRealtimeMpesaStatusResult {
  const [transaction, setTransaction] = useState<MpesaTransaction | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!checkoutRequestId) {
      setTransaction(null);
      setIsListening(false);
      return;
    }

    let channel: RealtimeChannel;

    const setupRealtimeSubscription = async () => {
      try {
        console.log('🔄 Setting up realtime subscription for:', checkoutRequestId);
        setIsListening(true);
        setError(null);

        // First, fetch the current state if it exists
        const { data: existingTransaction } = await supabase
          .from('mpesa_transactions')
          .select('result_code, result_desc, status, mpesa_receipt_number')
          .eq('checkout_request_id', checkoutRequestId)
          .maybeSingle();

        if (existingTransaction) {
          console.log('✅ Found existing transaction:', existingTransaction);
          setTransaction(existingTransaction);
        }

        // Subscribe to realtime updates
        channel = supabase
          .channel(`mpesa-${checkoutRequestId}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'mpesa_transactions',
              filter: `checkout_request_id=eq.${checkoutRequestId}`
            },
            (payload) => {
              console.log('🔔 Realtime payment update:', payload);
              
              if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
                const newTransaction = payload.new as any;
                
                // Only update if result_code actually changed to prevent redundant re-renders
                setTransaction(prev => {
                  const newResultCode = newTransaction.result_code;
                  if (prev?.result_code === newResultCode && newResultCode !== null) {
                    console.log('⏭️ Result code unchanged, skipping state update:', newResultCode);
                    return prev;
                  }
                  
                  console.log('✅ New result code detected, updating state:', {
                    previous: prev?.result_code,
                    new: newResultCode
                  });
                  
                  return {
                    result_code: newResultCode,
                    result_desc: newTransaction.result_desc,
                    status: newTransaction.status,
                    mpesa_receipt_number: newTransaction.mpesa_receipt_number
                  };
                });
              }
            }
          )
          .subscribe((status) => {
            console.log('📡 Realtime subscription status:', status);
            if (status === 'SUBSCRIBED') {
              console.log('✅ Successfully subscribed to M-Pesa updates');
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              console.error('❌ Realtime subscription error:', status);
              setError('Failed to connect to realtime updates');
              setIsListening(false);
            }
          });
      } catch (err) {
        console.error('❌ Error setting up realtime subscription:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
        setIsListening(false);
      }
    };

    setupRealtimeSubscription();

    // Cleanup
    return () => {
      if (channel) {
        console.log('🧹 Cleaning up realtime subscription');
        supabase.removeChannel(channel);
      }
      setIsListening(false);
    };
  }, [checkoutRequestId]);

  return {
    transaction,
    isListening,
    error
  };
}
