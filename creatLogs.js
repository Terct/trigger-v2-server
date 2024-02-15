const { createClient } = require('@supabase/supabase-js');
const moment = require('moment-timezone');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const moveTriggerToLogs = async () => {
    try {
        const { data: triggeredItems, error } = await supabase
            .from('dp-v2-trigger')
            .select('*')
            .eq('trigger_status', true);

        if (error) {
            throw error;
        }

        for (const item of triggeredItems) {
            try {
                const { data: insertData, error: insertError } = await supabase
                    .from('dp-v2-logs')
                    .insert([item]);

                if (insertError) {
                    throw insertError;
                }

                // Remove the moved item from the dp-v2-trigger table
                const { data: deleteData, deleteError } = await supabase
                    .from('dp-v2-trigger')
                    .delete()
                    .eq('message_id', item.message_id);

                if (deleteError) {
                    throw deleteError;
                }

            } catch (moveError) {
                console.error('Error moving item to dp-v2-logs:', moveError);
            }
        }
    } catch (error) {
        console.error('Error retrieving triggered items:', error);
    }
};

// Run the move operation initially
moveTriggerToLogs();

// Schedule the move operation to run every two minutes
setInterval(() => {
    moveTriggerToLogs();
}, 60000);
