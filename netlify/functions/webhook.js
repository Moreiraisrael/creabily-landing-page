const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
    // Permite apenas requisições POST
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const body = JSON.parse(event.body);
        const { 
            nome, whatsapp, email, instagram, 
            profissao, situacao, tempo, momento, faturamento, 
            dores, transformacao, nadaMudar, prosperou, prioridade, origem 
        } = body;

        // Validação básica (apenas dos mais críticos)
        if (!nome || !whatsapp || !email) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Campos principais são obrigatórios' })
            };
        }

        console.log(`[Webhook] Processando novo lead: ${nome}`);

        // Array para armazenar as Promises que rodarão em paralelo
        const rotinas = [];

        // ==========================================
        // 1. INSERIR DADOS NO SUPABASE
        // ==========================================
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_KEY; // ou SUPABASE_ANON_KEY / SERVICE_ROLE_KEY

        if (supabaseUrl && supabaseKey) {
            const supabase = createClient(supabaseUrl, supabaseKey);

            const now = new Date().toISOString();

            const supabasePromise = supabase
                .from('leads_b2b')
                .insert([
                    {
                        nome: nome,
                        whatsapp: whatsapp,
                        email: email,
                        instagram: instagram || null,
                        profissao: profissao || null,
                        situacao: situacao || null,
                        tempo: tempo || null,
                        momento: momento || null,
                        faturamento: faturamento || null,
                        dores: dores || null,
                        transformacao: transformacao || null,
                        nada_mudar: nadaMudar || null,
                        prosperou: prosperou || null,
                        prioridade: prioridade || null,
                        origem: origem || 'B2B',
                        status: 'novo_lead_quiz',
                        data: now,
                        last_interaction_at: now
                    }
                ])
                .select()
                .then(({ data, error }) => {
                    if (error) throw error;
                    console.log('[Supabase] Lead inserido com sucesso.', data);
                    return data;
                })
                .catch(err => {
                    console.error('[Supabase] Erro:', err);
                    throw err;
                });
            
            rotinas.push(supabasePromise);
        } else {
            console.warn('[Supabase] Variáveis de ambiente ausentes. Pulando inserção no banco.');
        }

        // ==========================================
        // 2. DISPARO WHATSAPP (Evolution API)
        // ==========================================
        const evolutionApiUrl = process.env.EVOLUTION_API_URL;
        const evolutionApiKey = process.env.EVOLUTION_API_KEY;
        const instanceName = process.env.EVOLUTION_INSTANCE_NAME;

        if (evolutionApiUrl && evolutionApiKey && instanceName) {
            const wppMessage = `Olá ${nome}! Aqui é do time da Creabily. Recebemos sua inscrição para saber mais sobre o nosso modelo de negócios. Logo um de nossos especialistas falará com você para tirar todas as dúvidas!`;
            
            // Formatando o número (removendo caracteres especiais se houver)
            let cleanNumber = whatsapp.replace(/\D/g, '');
            if (!cleanNumber.startsWith('55')) {
                cleanNumber = '55' + cleanNumber;
            }

            const wppPromise = fetch(`${evolutionApiUrl}/message/sendText/${instanceName}`, {
                method: 'POST',
                headers: {
                    'apikey': evolutionApiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    number: cleanNumber, 
                    options: {
                        delay: 2000,
                        presence: 'composing'
                    },
                    textMessage: {
                        text: wppMessage
                    }
                })
            })
            .then(res => {
                if (!res.ok) throw new Error(`Status ${res.status}`);
                console.log('[Evolution API] Mensagem enviada com sucesso.');
            })
            .catch(err => console.error('[Evolution API] Erro:', err));

            rotinas.push(wppPromise);
        } else {
            console.warn('[Evolution API] Variáveis de ambiente ausentes. Pulando envio de WhatsApp.');
        }

        // ==========================================
        // 3. DISPARO E-MAIL (Resend)
        // ==========================================
        const resendApiKey = process.env.RESEND_API_KEY;
        
        if (resendApiKey) {
            const emailPromise = fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${resendApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    from: 'Creabily Mentoria <contato@creabily.com>',
                    to: [email],
                    subject: 'Sua inscrição na Creabily foi confirmada!',
                    html: `
                        <div style="font-family: sans-serif; color: #333;">
                            <h2>Olá <strong>${nome}</strong>,</h2>
                            <p>Recebemos o seu Diagnóstico 360.</p>
                            <p>Notamos que sua principal dor no momento é: <em>"${dores}"</em>.</p>
                            <p>Entendemos perfeitamente as suas dificuldades e estamos prontos para te apresentar os bastidores do nosso sucesso para que você possa aplicar na sua clínica.</p>
                            <p>Fique de olho no seu WhatsApp, nossa equipe entrará em contato em breve!</p>
                            <br/>
                            <p>Um abraço,<br/><strong>Equipe Creabily</strong></p>
                        </div>
                    `
                })
            })
            .then(res => {
                if (!res.ok) throw new Error(`Status ${res.status}`);
                console.log('[Resend] E-mail enviado com sucesso.');
            })
            .catch(err => console.error('[Resend] Erro:', err));

            rotinas.push(emailPromise);
        } else {
            console.warn('[Resend] Variáveis de ambiente ausentes. Pulando envio de e-mail.');
        }

        // Aguarda todas as integrações terminarem
        const results = await Promise.allSettled(rotinas);
        const failures = results.filter(r => r.status === 'rejected');

        if (failures.length > 0) {
            console.error('Falhas nas integrações:', failures);
            return {
                statusCode: 207, // Multi-Status
                body: JSON.stringify({ success: false, message: 'Processado com erros nas integrações', errors: failures.map(f => f.reason ? JSON.stringify(f.reason) : 'Erro desconhecido') })
            };
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, message: 'Lead processado', results: results })
        };

    } catch (error) {
        console.error('Erro na execução da function:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Erro interno no processamento' })
        };
    }
};
